package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

// externalRoots holds directories that the user explicitly granted access to
// by opening a file from outside a vault (Obsidian 1.14+). Entries are kept in
// memory and cleared when the server restarts.
var (
	externalRootsMu sync.RWMutex
	externalRoots   = make(map[string]struct{})
)

// resolveForPolicy resolves symlinks in path so allowlist checks cannot be
// bypassed by a link inside an allowed directory. If the file itself does not
// exist yet (writes, mkdir), its nearest existing parent is resolved instead.
func resolveForPolicy(path string) string {
	path = filepath.Clean(path)
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return filepath.Clean(resolved)
	}
	if resolved, err := filepath.EvalSymlinks(filepath.Dir(path)); err == nil {
		return filepath.Join(resolved, filepath.Base(path))
	}
	return path
}

// isAllowedExternalPath reports whether path is inside a directory that was
// registered through ExternalAllow.
func isAllowedExternalPath(path string) bool {
	path = resolveForPolicy(path)

	externalRootsMu.RLock()
	defer externalRootsMu.RUnlock()

	for root := range externalRoots {
		if path == root {
			return true
		}
		if strings.HasPrefix(path, root+string(os.PathSeparator)) {
			return true
		}
	}
	return false
}

// registerExternalRoot records dir as an allowed root. Paths outside OSH_HOME
// are ignored so a malformed request can never widen access beyond the
// configured root.
func registerExternalRoot(dir string) {
	dir = resolveForPolicy(dir)
	if !isWithinHome(dir) {
		return
	}

	externalRootsMu.Lock()
	externalRoots[dir] = struct{}{}
	externalRootsMu.Unlock()
}

// ExternalAllow registers a user-selected file so that Obsidian's "open file
// from outside the vault" feature can read and write it. The parent directory
// is registered instead of the single file because external notes can embed
// images and link to sibling files in the same folder.
//
// The path must resolve to a regular file inside OSH_HOME. Symlinks are
// resolved before the check so a link inside OSH_HOME cannot point elsewhere.
func ExternalAllow(c *gin.Context) {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Path == "" {
		c.JSON(http.StatusBadRequest, map[string]any{"ok": false, "error": "path is required"})
		return
	}

	path := filepath.Clean(body.Path)
	if !filepath.IsAbs(path) || !isWithinHome(path) {
		c.JSON(http.StatusForbidden, map[string]any{"ok": false, "error": "path is outside OSH_HOME"})
		return
	}

	realPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		c.JSON(http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	realPath = filepath.Clean(realPath)
	if !isWithinHome(realPath) {
		c.JSON(http.StatusForbidden, map[string]any{"ok": false, "error": "resolved path is outside OSH_HOME"})
		return
	}

	info, err := os.Stat(realPath)
	if err != nil {
		c.JSON(http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if !info.Mode().IsRegular() {
		c.JSON(http.StatusOK, map[string]any{"ok": false, "error": "not a regular file"})
		return
	}

	registerExternalRoot(filepath.Dir(realPath))

	c.JSON(http.StatusOK, map[string]any{"ok": true, "path": path, "realPath": realPath})
}
