package handler

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"

	"osh/config"
)

const (
	keyKeyringDesc  = "osh-keychain"
	keyFile         = ".osh-keychain.key"
	secretsFileName = ".osh-secrets.json"
	aesKeySize      = 32 // AES-256
	lsBackupService = "__obsidian-ls__"
)

// ---------------------------------------------------------------------------
// Per-vault key cache
// ---------------------------------------------------------------------------

var (
	// vaultKeyCache maps vaultPath (or "" for global) → AES-256 key bytes.
	vaultKeyCache   = map[string][]byte{}
	vaultKeyCacheMu sync.RWMutex
)

// vaultPathFromID resolves a vault ID to its filesystem path.
// Returns "" if the ID is empty or unknown.
func vaultPathFromID(vaultID string) string {
	if vaultID == "" {
		return ""
	}
	path, ok := config.VaultByID(vaultID)
	if !ok {
		return ""
	}
	return path
}

// obsidianDir returns the .obsidian subdirectory path inside a vault.
func obsidianDir(vaultPath string) string {
	return filepath.Join(vaultPath, ".obsidian")
}

// getKeyForPath returns the AES-256 master key for vaultPath, loading or
// creating it on first access. vaultPath="" falls back to legacy global paths.
func getKeyForPath(vaultPath string) ([]byte, error) {
	vaultKeyCacheMu.RLock()
	if k, ok := vaultKeyCache[vaultPath]; ok {
		vaultKeyCacheMu.RUnlock()
		return k, nil
	}
	vaultKeyCacheMu.RUnlock()

	vaultKeyCacheMu.Lock()
	defer vaultKeyCacheMu.Unlock()
	if k, ok := vaultKeyCache[vaultPath]; ok {
		return k, nil
	}

	k, err := loadOrCreateKey(vaultPath)
	if err != nil {
		return nil, err
	}
	vaultKeyCache[vaultPath] = k
	return k, nil
}

// keyctlStore stores data in the Linux kernel keyring via stdin (not argv).
func keyctlStore(desc, data string) error {
	cmd := exec.Command("keyctl", "padd", "--user", desc)
	cmd.Stdin = strings.NewReader(data)
	_, err := cmd.Output()
	return err
}

// keyctlLoad reads a key from the Linux kernel keyring.
func keyctlLoad(desc string) (string, error) {
	cmd := exec.Command("keyctl", "pipe", "--user", desc)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func generateKey() ([]byte, error) {
	key := make([]byte, aesKeySize)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	return key, nil
}

// loadOrCreateKey loads the AES-256 key for the given vault, creating and
// persisting a new one when none exists.
//
// Resolution order:
//  1. Linux kernel keyring (keyctl) — global, survives reboots in user session
//  2. <vault>/.obsidian/.osh-keychain.key — portable per-vault file
//  3. ~/.config/.osh-keychain.key — legacy path, migrated on read
//  4. Generate fresh key, persist to vault dir (or ~/.config if no vault)
func loadOrCreateKey(vaultPath string) ([]byte, error) {
	// 1. Kernel keyring
	if hexKey, err := keyctlLoad(keyKeyringDesc); err == nil && hexKey != "" {
		if k, err := hex.DecodeString(hexKey); err == nil && len(k) == aesKeySize {
			log.Println("[keychain] loaded key from kernel keyring")
			return k, nil
		}
	}

	// 2. Vault .obsidian dir
	if vaultPath != "" {
		keyPath := filepath.Join(obsidianDir(vaultPath), keyFile)
		if data, err := os.ReadFile(keyPath); err == nil && len(data) == aesKeySize {
			log.Printf("[keychain] loaded key from vault dir: %s", keyPath)
			return data, nil
		}
	}

	// 3. Legacy ~/.config fallback — migrate on read
	if cfgDir, err := os.UserConfigDir(); err == nil {
		legacyPath := filepath.Join(cfgDir, keyFile)
		if data, err := os.ReadFile(legacyPath); err == nil && len(data) == aesKeySize {
			log.Println("[keychain] loaded key from ~/.config (legacy)")
			if vaultPath != "" {
				oDir := obsidianDir(vaultPath)
				if err := os.MkdirAll(oDir, 0700); err == nil {
					if err := os.WriteFile(filepath.Join(oDir, keyFile), data, 0600); err == nil {
						log.Printf("[keychain] migrated key to vault dir: %s", oDir)
					}
				}
			}
			return data, nil
		}
	}

	// 4. Generate a fresh key and persist it
	k, err := generateKey()
	if err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}

	hexStr := hex.EncodeToString(k)
	if storeErr := keyctlStore(keyKeyringDesc, hexStr); storeErr == nil {
		log.Println("[keychain] stored new key in kernel keyring")
	} else {
		log.Printf("[keychain] keyctl unavailable (%v), using file fallback", storeErr)
		if vaultPath != "" {
			oDir := obsidianDir(vaultPath)
			if err := os.MkdirAll(oDir, 0700); err == nil {
				if err := os.WriteFile(filepath.Join(oDir, keyFile), k, 0600); err == nil {
					log.Printf("[keychain] stored new key in vault dir: %s", oDir)
				} else {
					log.Printf("[keychain] failed to write key to vault dir: %v", err)
				}
			}
		} else {
			cfgDir, cerr := os.UserConfigDir()
			if cerr != nil {
				cfgDir = "/etc/osh"
			}
			keyPath := filepath.Join(cfgDir, keyFile)
			if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err == nil {
				if err := os.WriteFile(keyPath, k, 0600); err == nil {
					log.Println("[keychain] stored new key in ~/.config (no vault path)")
				}
			}
		}
	}

	return k, nil
}

// ---------------------------------------------------------------------------
// AES-256-GCM helpers
// ---------------------------------------------------------------------------

// encryptAESGCM encrypts plaintext and returns base64(nonce ‖ ciphertext ‖ tag).
func encryptAESGCM(plaintext []byte, vaultPath string) (string, error) {
	key, err := getKeyForPath(vaultPath)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aesgcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := aesgcm.Seal(nil, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(append(nonce, ciphertext...)), nil
}

// decryptAESGCM decrypts base64(nonce ‖ ciphertext ‖ tag) and returns the plaintext.
func decryptAESGCM(encoded string, vaultPath string) ([]byte, error) {
	key, err := getKeyForPath(vaultPath)
	if err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := aesgcm.NonceSize()
	if len(data) < nonceSize {
		return nil, io.ErrUnexpectedEOF
	}
	return aesgcm.Open(nil, data[:nonceSize], data[nonceSize:], nil)
}

// ---------------------------------------------------------------------------
// Public encryption API (used by IPC dispatch and HTTP handlers)
// ---------------------------------------------------------------------------

// InitKeychain is kept for backwards-compatibility; key loading is now lazy per-vault.
func InitKeychain() {}

// SafeStorageIsAvailable returns true when encryption is available for vaultPath.
func SafeStorageIsAvailable(vaultPath string) bool {
	_, err := getKeyForPath(vaultPath)
	return err == nil
}

// SafeStorageBackend returns a descriptive backend name for display purposes.
// Returns "gnome_libsecret" when the kernel keyring is active, "basic_text" otherwise.
func SafeStorageBackend(vaultPath string) string {
	if hexKey, err := keyctlLoad(keyKeyringDesc); err == nil && hexKey != "" {
		if k, err := hex.DecodeString(hexKey); err == nil && len(k) == aesKeySize {
			return "gnome_libsecret"
		}
	}
	return "basic_text"
}

// SafeStorageEncrypt encrypts plaintext with the vault-specific AES-256-GCM key
// and returns base64(nonce ‖ ciphertext ‖ tag).
func SafeStorageEncrypt(plaintext, vaultPath string) (string, error) {
	return encryptAESGCM([]byte(plaintext), vaultPath)
}

// SafeStorageDecrypt decrypts a base64-encoded AES-256-GCM blob produced by SafeStorageEncrypt.
func SafeStorageDecrypt(encoded, vaultPath string) (string, error) {
	b, err := decryptAESGCM(encoded, vaultPath)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ---------------------------------------------------------------------------
// localStorage backup — lets the browser shim persist the specific localStorage
// keys used by Obsidian's secrets store (secrets-encrypted, secrets-meta) to
// .osh-secrets.json so they survive browser data clears and work cross-device.
//
// Values are stored verbatim (they are already AES-256-GCM encrypted by Obsidian
// before being placed in localStorage, so no additional encryption is needed).
// ---------------------------------------------------------------------------

// LsBackupSet persists a localStorage value (identified by its key suffix) to
// .osh-secrets.json under the __obsidian-ls__ service.
func LsBackupSet(suffix, value, vaultPath string) {
	vaultSecretStoresMu.Lock()
	defer vaultSecretStoresMu.Unlock()
	ensureVaultStore(vaultPath)
	store := vaultSecretStores[vaultPath]
	if store[lsBackupService] == nil {
		store[lsBackupService] = make(map[string]string)
	}
	store[lsBackupService][suffix] = value
	persistVaultStore(vaultPath)
	log.Printf("[ls-backup] set suffix=%s (%d bytes)", suffix, len(value))
}

// LsBackupGet retrieves a backed-up localStorage value by key suffix.
// Returns ("", false) when not found.
func LsBackupGet(suffix, vaultPath string) (string, bool) {
	vaultSecretStoresMu.Lock()
	defer vaultSecretStoresMu.Unlock()
	ensureVaultStore(vaultPath)
	store := vaultSecretStores[vaultPath]
	if store[lsBackupService] == nil {
		return "", false
	}
	v, ok := store[lsBackupService][suffix]
	return v, ok && v != ""
}

// LsBackupDelete removes a backed-up localStorage value.
func LsBackupDelete(suffix, vaultPath string) {
	vaultSecretStoresMu.Lock()
	defer vaultSecretStoresMu.Unlock()
	ensureVaultStore(vaultPath)
	store := vaultSecretStores[vaultPath]
	if store[lsBackupService] == nil {
		return
	}
	delete(store[lsBackupService], suffix)
	persistVaultStore(vaultPath)
}

// ---------------------------------------------------------------------------
// Per-vault secret key-value store
// ---------------------------------------------------------------------------

var (
	// vaultSecretStores maps vaultPath → service → account → encrypted-value.
	vaultSecretStores   = map[string]map[string]map[string]string{}
	vaultSecretStoresMu sync.Mutex
)

// InitSecretStore is kept for backwards-compatibility; stores are now loaded lazily per-vault.
func InitSecretStore() {}

func secretsFilePath(vaultPath string) string {
	if vaultPath != "" {
		return filepath.Join(obsidianDir(vaultPath), secretsFileName)
	}
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		cfgDir = "/etc/osh"
	}
	return filepath.Join(cfgDir, secretsFileName)
}

func loadSecretStoreFile(path string) map[string]map[string]string {
	store := make(map[string]map[string]string)
	data, err := os.ReadFile(path)
	if err != nil {
		return store
	}
	if err := json.Unmarshal(data, &store); err != nil {
		log.Printf("[secretstore] corrupt file %s, starting fresh: %v", path, err)
		return make(map[string]map[string]string)
	}
	log.Printf("[secretstore] loaded %d services from %s", len(store), path)
	return store
}

// ensureVaultStore loads the secret store for vaultPath if not yet cached.
// Must be called with vaultSecretStoresMu held.
func ensureVaultStore(vaultPath string) {
	if vaultSecretStores[vaultPath] == nil {
		vaultSecretStores[vaultPath] = loadSecretStoreFile(secretsFilePath(vaultPath))
	}
}

func persistVaultStore(vaultPath string) {
	store := vaultSecretStores[vaultPath]
	path := secretsFilePath(vaultPath)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		log.Printf("[secretstore] mkdir error: %v", err)
		return
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		log.Printf("[secretstore] marshal error: %v", err)
		return
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		log.Printf("[secretstore] write error: %v", err)
	} else {
		log.Printf("[secretstore] saved %d services to %s", len(store), path)
	}
}

// SecretStorageSet stores an already-encrypted value under service+account.
func SecretStorageSet(service, account, value, vaultPath string) error {
	vaultSecretStoresMu.Lock()
	defer vaultSecretStoresMu.Unlock()
	ensureVaultStore(vaultPath)
	store := vaultSecretStores[vaultPath]
	if store[service] == nil {
		store[service] = make(map[string]string)
	}
	store[service][account] = value
	persistVaultStore(vaultPath)
	return nil
}

// SecretStorageGet retrieves an encrypted value by service+account.
// Returns ("", nil) when not found.
func SecretStorageGet(service, account, vaultPath string) (string, error) {
	vaultSecretStoresMu.Lock()
	defer vaultSecretStoresMu.Unlock()
	ensureVaultStore(vaultPath)
	store := vaultSecretStores[vaultPath]
	if store[service] == nil {
		return "", nil
	}
	return store[service][account], nil
}

// SecretStorageDelete removes a stored secret.
func SecretStorageDelete(service, account, vaultPath string) error {
	vaultSecretStoresMu.Lock()
	defer vaultSecretStoresMu.Unlock()
	ensureVaultStore(vaultPath)
	store := vaultSecretStores[vaultPath]
	if store[service] != nil {
		delete(store[service], account)
		persistVaultStore(vaultPath)
	}
	return nil
}

// SecretStorageList returns all account IDs registered under service.
func SecretStorageList(service, vaultPath string) ([]string, error) {
	vaultSecretStoresMu.Lock()
	defer vaultSecretStoresMu.Unlock()
	ensureVaultStore(vaultPath)
	store := vaultSecretStores[vaultPath]
	if store[service] == nil {
		return []string{}, nil
	}
	ids := make([]string, 0, len(store[service]))
	for id := range store[service] {
		ids = append(ids, id)
	}
	return ids, nil
}

// ---------------------------------------------------------------------------
// Gin handlers — /api/safe-storage/* and /api/secret-storage/*
// These are fallback endpoints; the shim normally uses WebSocket IPC.
// ---------------------------------------------------------------------------

// GET /api/safe-storage/status?vault=<id>
func SafeStorageStatusHandler(c *gin.Context) {
	vaultPath := vaultPathFromID(c.Query("vault"))
	c.JSON(http.StatusOK, map[string]any{
		"available": SafeStorageIsAvailable(vaultPath),
		"backend":   SafeStorageBackend(vaultPath),
	})
}

// POST /api/safe-storage/encrypt?vault=<id>  body: {"plaintext":"..."}
func SafeStorageEncryptHandler(c *gin.Context) {
	var req struct {
		Plaintext string `json:"plaintext"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.String(http.StatusBadRequest, "invalid request body")
		return
	}
	vaultPath := vaultPathFromID(c.Query("vault"))
	enc, err := SafeStorageEncrypt(req.Plaintext, vaultPath)
	if err != nil {
		c.String(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, map[string]any{"encrypted": enc})
}

// POST /api/safe-storage/decrypt?vault=<id>  body: {"encrypted":"..."}
func SafeStorageDecryptHandler(c *gin.Context) {
	var req struct {
		Encrypted string `json:"encrypted"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.String(http.StatusBadRequest, "invalid request body")
		return
	}
	vaultPath := vaultPathFromID(c.Query("vault"))
	plain, err := SafeStorageDecrypt(req.Encrypted, vaultPath)
	if err != nil {
		c.String(http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, map[string]any{"plaintext": plain})
}

// POST /api/secret-storage/set?vault=<id>  body: {"service":"...","account":"...","value":"..."}
func SecretStorageSetHandler(c *gin.Context) {
	var req struct {
		Service string `json:"service"`
		Account string `json:"account"`
		Value   string `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.String(http.StatusBadRequest, "bad request")
		return
	}
	vaultPath := vaultPathFromID(c.Query("vault"))
	if err := SecretStorageSet(req.Service, req.Account, req.Value, vaultPath); err != nil {
		c.String(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ok": true})
}

// GET /api/secret-storage/get?vault=<id>&service=...&account=...
func SecretStorageGetHandler(c *gin.Context) {
	vaultPath := vaultPathFromID(c.Query("vault"))
	val, err := SecretStorageGet(c.Query("service"), c.Query("account"), vaultPath)
	if err != nil {
		c.String(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, map[string]any{"value": val})
}

// POST /api/secret-storage/delete?vault=<id>  body: {"service":"...","account":"..."}
func SecretStorageDeleteHandler(c *gin.Context) {
	var req struct {
		Service string `json:"service"`
		Account string `json:"account"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.String(http.StatusBadRequest, "bad request")
		return
	}
	vaultPath := vaultPathFromID(c.Query("vault"))
	SecretStorageDelete(req.Service, req.Account, vaultPath)
	c.JSON(http.StatusOK, map[string]any{"ok": true})
}

// GET /api/secret-storage/list?vault=<id>&service=...
func SecretStorageListHandler(c *gin.Context) {
	vaultPath := vaultPathFromID(c.Query("vault"))
	ids, err := SecretStorageList(c.Query("service"), vaultPath)
	if err != nil {
		c.String(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, map[string]any{"ids": ids})
}
