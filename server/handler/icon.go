package handler

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"osh/config"
)

type iconMetaResponse struct {
	HasCustom bool   `json:"hasCustom"`
	Path      string `json:"path,omitempty"`
}

var iconExts = []string{".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif"}

func findCustomIconForVault(vaultID string, label string) string {
	for _, ext := range iconExts {
		p := filepath.Join(vaultIconsDir(vaultID), label+ext)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func vaultIconsDir(vaultID string) string {
	vaultPath, ok := config.VaultByID(vaultID)
	if !ok {
		return ""
	}
	return filepath.Join(vaultPath, ".obsidian", ".osh-icons")
}

func IconHandler(c *gin.Context) {
	vaultID := c.Query("vaultId")
	label := c.Query("label")

	if vaultID == "" || label == "" {
		c.String(http.StatusBadRequest, "vaultId and label required")
		return
	}

	iconPath := findCustomIconForVault(vaultID, label)
	if iconPath == "" {
		c.Status(http.StatusNoContent)
		return
	}

	data, err := os.ReadFile(iconPath)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}

	ext := strings.ToLower(filepath.Ext(iconPath))
	mime := iconMime(ext)
	c.Data(http.StatusOK, mime, data)
}

func iconMime(ext string) string {
	switch ext {
	case ".png":
		return "image/png"
	case ".svg":
		return "image/svg+xml"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	}
	return "application/octet-stream"
}

func IconMetaHandler(c *gin.Context) {
	vaultID := c.Query("vaultId")
	label := c.Query("label")

	if vaultID == "" || label == "" {
		c.JSON(http.StatusOK, iconMetaResponse{HasCustom: false})
		return
	}

	iconPath := findCustomIconForVault(vaultID, label)
	if iconPath == "" {
		c.JSON(http.StatusOK, iconMetaResponse{HasCustom: false})
		return
	}
	c.JSON(http.StatusOK, iconMetaResponse{HasCustom: true, Path: iconPath})
}

func IconSaveHandler(c *gin.Context) {
	var body struct {
		VaultID string `json:"vaultId"`
		Label   string `json:"label"`
		Data    string `json:"data"`
		Format  string `json:"format"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	if body.VaultID == "" || body.Label == "" || body.Data == "" || body.Format == "" {
		c.JSON(http.StatusOK, map[string]string{"error": "missing fields"})
		return
	}

	dir := vaultIconsDir(body.VaultID)
	if dir == "" {
		c.JSON(http.StatusOK, map[string]string{"error": "vault icons dir not found"})
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}

	raw := body.Data
	if strings.HasPrefix(raw, "data:") {
		if idx := strings.Index(raw, ","); idx != -1 {
			raw = raw[idx+1:]
		}
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": "invalid base64: " + err.Error()})
		return
	}

	ext := "." + body.Format
	dest := filepath.Join(dir, body.Label+ext)
	if err := os.WriteFile(dest, decoded, 0o644); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func IconClearHandler(c *gin.Context) {
	var body struct {
		VaultID string `json:"vaultId"`
		Label   string `json:"label"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	if body.VaultID == "" || body.Label == "" {
		c.JSON(http.StatusOK, map[string]string{"error": "missing fields"})
		return
	}

	iconPath := findCustomIconForVault(body.VaultID, body.Label)
	if iconPath == "" {
		c.JSON(http.StatusOK, map[string]string{"error": "no custom icon"})
		return
	}
	if err := os.Remove(iconPath); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func IconListHandler(c *gin.Context) {
	vaultID := c.Query("vaultId")
	if vaultID == "" {
		c.String(http.StatusBadRequest, "vaultId required")
		return
	}

	dir := vaultIconsDir(vaultID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		c.JSON(http.StatusOK, map[string]any{"icons": []string{}})
		return
	}

	type iconEntry struct {
		Label string `json:"label"`
		Ext   string `json:"ext"`
		Path  string `json:"path"`
	}

	var icons []iconEntry
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := filepath.Ext(e.Name())
		name := strings.TrimSuffix(e.Name(), ext)
		icons = append(icons, iconEntry{
			Label: name,
			Ext:   strings.TrimPrefix(ext, "."),
			Path:  filepath.Join(dir, e.Name()),
		})
	}

	c.JSON(http.StatusOK, map[string]any{"icons": icons})
}

func VaultIconResetHandler(c *gin.Context) {
	var body struct {
		VaultID string `json:"vaultId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	if body.VaultID == "" {
		c.JSON(http.StatusOK, map[string]string{"error": "missing vaultId"})
		return
	}

	dir := vaultIconsDir(body.VaultID)
	if err := os.RemoveAll(dir); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------------------
// Stubs for legacy IPC dispatch — these are handled client-side by the shim
// but are still referenced by ipc.go dispatchSync for channels "get-icon"
// and "set-icon".
// ---------------------------------------------------------------------------

func findCustomIconPath() string { return "" }

func saveCustomIcon(_ string, _ string) error { return nil }

func clearCustomIcon() {}
