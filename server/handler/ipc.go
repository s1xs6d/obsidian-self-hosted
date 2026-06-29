package handler

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"osh/config"
)

// ipcRequest is the JSON body sent to /ipc/sync and /ipc/async.
type ipcRequest struct {
	Channel string `json:"channel"`
	Args    []any  `json:"args"`
}

// SyncIPC handles POST /ipc/sync. It processes the channel synchronously and
// writes the return value as JSON. The vault context comes from ?vault=<id>.
func SyncIPC(c *gin.Context) {
	var req ipcRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.String(http.StatusBadRequest, "bad request: "+err.Error())
		return
	}

	vaultID := c.Query("vault")
	result, err := DispatchSync(req.Channel, req.Args, vaultID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// AsyncIPC handles POST /ipc/async. It starts handling in a goroutine and
// immediately responds 202 Accepted.
func AsyncIPC(c *gin.Context) {
	var req ipcRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.String(http.StatusBadRequest, "bad request: "+err.Error())
		return
	}

	vaultID := c.Query("vault")
	go DispatchAsync(req.Channel, req.Args, vaultID)
	c.Status(http.StatusAccepted)
}

// ---------------------------------------------------------------------------
// Channel dispatch
// ---------------------------------------------------------------------------

// dispatchSync handles every synchronous IPC channel and returns a value that
// will be JSON-encoded and returned verbatim to the renderer.
func DispatchSync(channel string, args []any, vaultID string) (any, error) {
	switch channel {

	// ---- Vault info --------------------------------------------------------

	case "vault":
		if vaultID == "" {
			return map[string]any{}, nil
		}
		path, ok := config.VaultByID(vaultID)
		if !ok {
			return map[string]any{}, nil
		}
		return map[string]any{"id": vaultID, "path": path}, nil

	case "vault-list":
		vaults := config.VaultList()
		out := make(map[string]any, len(vaults))
		for id, v := range vaults {
			out[id] = map[string]any{
				"path": v.Path,
				"ts":   v.Ts,
				"open": false,
			}
		}
		return out, nil

	case "vault-open":
		path, err := argString(args, 0, "path")
		if err != nil {
			return err.Error(), nil
		}
		create, _ := args[safeIdx(args, 1)].(bool)
		if create {
			if err := os.MkdirAll(path, 0o755); err != nil {
				return err.Error(), nil
			}
		} else {
			if _, err := os.Stat(path); err != nil {
				return err.Error(), nil
			}
		}
		vaultID, err := config.AddVault(path)
		if err != nil {
			return err.Error(), nil
		}
		return map[string]any{"ok": true, "id": vaultID, "__navigate__": "/app?vault=" + vaultID}, nil

	case "vault-remove":
		path, err := argString(args, 0, "path")
		if err != nil {
			return false, nil
		}
		removed, err := config.RemoveVault(path)
		if err != nil {
			return false, nil
		}
		return removed, nil

	case "vault-move":
		oldPath, err := argString(args, 0, "oldPath")
		if err != nil {
			return err.Error(), nil
		}
		newPath, err := argString(args, 1, "newPath")
		if err != nil {
			return err.Error(), nil
		}
		if _, err := config.MoveVault(oldPath, newPath); err != nil {
			return err.Error(), nil
		}
		return "", nil

	case "vault-message":
		return "", nil

	// ---- Keychain (safe-storage) --------------------------------------------

	case "safe-storage-is-available":
		vaultPath := vaultPathFromID(vaultID)
		log.Println("[ipc] safe-storage-is-available")
		return map[string]any{"available": SafeStorageIsAvailable(vaultPath)}, nil

	case "safe-storage-backend":
		vaultPath := vaultPathFromID(vaultID)
		log.Println("[ipc] safe-storage-backend")
		return map[string]any{"backend": SafeStorageBackend(vaultPath)}, nil

	case "safe-storage-encrypt":
		plaintext, _ := argString(args, 0, "plaintext")
		vaultPath := vaultPathFromID(vaultID)
		log.Printf("[ipc] safe-storage-encrypt (%d chars)", len(plaintext))
		enc, err := SafeStorageEncrypt(plaintext, vaultPath)
		if err != nil {
			return nil, err
		}
		return map[string]any{"encrypted": enc}, nil

	case "safe-storage-decrypt":
		encoded, _ := argString(args, 0, "encrypted")
		vaultPath := vaultPathFromID(vaultID)
		log.Printf("[ipc] safe-storage-decrypt (%d chars)", len(encoded))
		plain, err := SafeStorageDecrypt(encoded, vaultPath)
		if err != nil {
			return nil, err
		}
		return map[string]any{"plaintext": plain}, nil

	// ---- Secret key-value store -------------------------------------------------

	case "secret-storage-set":
		service, _ := argString(args, 0, "service")
		account, _ := argString(args, 1, "account")
		value, _ := argString(args, 2, "value")
		vaultPath := vaultPathFromID(vaultID)
		log.Printf("[ipc] secret-storage-set service=%s account=%s (%d chars)", service, account, len(value))
		if err := SecretStorageSet(service, account, value, vaultPath); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil

	case "secret-storage-get":
		service, _ := argString(args, 0, "service")
		account, _ := argString(args, 1, "account")
		vaultPath := vaultPathFromID(vaultID)
		log.Printf("[ipc] secret-storage-get service=%s account=%s", service, account)
		val, err := SecretStorageGet(service, account, vaultPath)
		if err != nil {
			return nil, err
		}
		return map[string]any{"value": val}, nil

	case "secret-storage-delete":
		service, _ := argString(args, 0, "service")
		account, _ := argString(args, 1, "account")
		vaultPath := vaultPathFromID(vaultID)
		log.Printf("[ipc] secret-storage-delete service=%s account=%s", service, account)
		SecretStorageDelete(service, account, vaultPath)
		return map[string]any{"ok": true}, nil

	case "secret-storage-list":
		service, _ := argString(args, 0, "service")
		vaultPath := vaultPathFromID(vaultID)
		log.Printf("[ipc] secret-storage-list service=%s", service)
		ids, err := SecretStorageList(service, vaultPath)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ids": ids}, nil

	// ---- localStorage backup (secrets-encrypted / secrets-meta) -----------
	// The shim mirrors these specific localStorage keys to .osh-secrets.json
	// so keychain data survives browser clears and works across devices.

	case "ls-backup-set":
		suffix, _ := argString(args, 0, "suffix")
		value, _ := argString(args, 1, "value")
		vaultPath := vaultPathFromID(vaultID)
		LsBackupSet(suffix, value, vaultPath)
		return map[string]any{"ok": true}, nil

	case "ls-backup-get":
		suffix, _ := argString(args, 0, "suffix")
		vaultPath := vaultPathFromID(vaultID)
		v, found := LsBackupGet(suffix, vaultPath)
		if !found {
			return map[string]any{"value": nil}, nil
		}
		return map[string]any{"value": v}, nil

	case "ls-backup-delete":
		suffix, _ := argString(args, 0, "suffix")
		vaultPath := vaultPathFromID(vaultID)
		LsBackupDelete(suffix, vaultPath)
		return map[string]any{"ok": true}, nil

	// ---- App metadata -------------------------------------------------------

	case "starter":
		return nil, nil

	case "version":
		return config.Version, nil

	case "is-dev":
		return false, nil

	case "file-url":
		return "/vault-files/", nil

	case "resources":
		return "/", nil

	// ---- Window / frame -----------------------------------------------------

	case "frame":
		return "native", nil

	// ---- Paths --------------------------------------------------------------

	case "documents-dir", "get-documents-path":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Documents"), nil

	case "desktop-dir":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Desktop"), nil

	case "get-default-vault-path":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Documents", "Obsidian Vault"), nil

	case "get-sandbox-vault-path":
		dir, _ := os.UserConfigDir()
		return filepath.Join(dir, "osh", "Sandbox"), nil

	// ---- Home directory (used by the os shim) --------------------------------

	case "get-home-dir":
		home, _ := os.UserHomeDir()
		return home, nil

	case "get-path":
		name, _ := argString(args, 0, "name")
		home, _ := os.UserHomeDir()
		switch name {
		case "home":
			return home, nil
		case "documents":
			return filepath.Join(home, "Documents"), nil
		case "downloads":
			return filepath.Join(home, "Downloads"), nil
		case "desktop":
			return filepath.Join(home, "Desktop"), nil
		case "temp", "tmp":
			return os.TempDir(), nil
		case "userData", "appData":
			dir, _ := os.UserConfigDir()
			return filepath.Join(dir, "osh"), nil
		case "logs":
			dir, _ := os.UserConfigDir()
			return filepath.Join(dir, "osh", "logs"), nil
		default:
			return home, nil
		}

	// ---- open-url -----------------------------------------------------------

	case "open-url":
		return nil, nil

	case "trash":
		path, err := argString(args, 0, "path")
		if err != nil || !isAllowedPath(path) {
			return false, nil
		}
		if err := os.Remove(path); err != nil {
			return false, nil
		}
		return true, nil

	// ---- Network requests ---------------------------------------------------

	case "request-url":
		return nil, nil

	// ---- Update / lifecycle -------------------------------------------------

	case "is-quitting":
		return false, nil

	case "update":
		return "", nil

	case "check-update":
		return false, nil

	case "disable-gpu":
		return false, nil

	case "print-to-pdf":
		return nil, nil

	case "relaunch":
		return nil, nil

	// ---- Build / environment flags -----------------------------------------

	case "insider-build":
		return false, nil

	case "disable-update":
		return false, nil

	case "cli":
		return map[string]any{}, nil

	case "register-cli":
		return nil, nil

	// ---- Sandbox ------------------------------------------------------------

	case "sandbox":
		return false, nil

	// ---- Icon ---------------------------------------------------------------

	case "get-icon":
		if findCustomIconPath() != "" {
			return "api/icon", nil
		}
		return nil, nil

	case "set-icon":
		fn, _ := argString(args, 0, "fn")
		b64, _ := argString(args, 1, "data")
		if fn != "" && b64 != "" {
			_ = saveCustomIcon(fn, b64)
		} else {
			clearCustomIcon()
		}
		return nil, nil

	// ---- Native menu --------------------------------------------------------

	case "set-menu", "render-menu", "update-menu-items":
		return nil, nil

	// ---- Adblock (Obsidian Sync related) -----------------------------------

	case "adblock-frequency":
		return 0, nil

	case "adblock-lists":
		return []any{}, nil

	// ---- Plugin ASAR copy --------------------------------------------------

	case "copy-asar":
		return nil, nil

	// ---- Webview session ---------------------------------------------------

	case "create-browser-session":
		return nil, nil

	// ---- Context menu (bidirectional: send triggers once response) ----------

	case "context-menu":
		return nil, nil

	default:
		return nil, fmt.Errorf("unknown IPC channel: %s", channel)
	}
}

// dispatchAsync handles fire-and-forget IPC channels.
func DispatchAsync(channel string, args []any, _ string) {
	switch channel {
	case "request-url":
	case "set-menu", "render-menu", "update-menu-items",
		"insider-build", "create-browser-session":
	default:
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// argString extracts a string from args at index idx.
func argString(args []any, idx int, name string) (string, error) {
	if idx >= len(args) {
		return "", fmt.Errorf("missing argument %q at index %d", name, idx)
	}
	s, ok := args[idx].(string)
	if !ok {
		return "", fmt.Errorf("argument %q must be a string", name)
	}
	return s, nil
}

// safeIdx returns idx if it is within bounds, otherwise len(args)-1 (which
// may still be out of range — callers must check with a type assertion).
func safeIdx(args []any, idx int) int {
	if idx < len(args) {
		return idx
	}
	return len(args) - 1
}
