package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"osh/config"
	"osh/middleware"
)

// dispatchEngine is the main gin engine, set once at startup so DispatchFSOp
// can serve requests through it without creating a new engine each call.
var dispatchEngine http.Handler

// SetDispatchEngine must be called after RegisterRoutes to enable DispatchFSOp.
func SetDispatchEngine(h http.Handler) { dispatchEngine = h }

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

func isAllowedPath(path string) bool {
	return isAllowedPathForVault(path, "")
}

func isAllowedPathForVault(path string, vaultID string) bool {
	path = filepath.Clean(path)
	vaults := config.VaultList()

	if vaultID != "" {
		if v, ok := vaults[vaultID]; ok {
			rel, err := filepath.Rel(v.Path, path)
			if err == nil && !strings.HasPrefix(rel, "..") {
				return true
			}
			if path == filepath.Clean(v.Path) {
				return true
			}
		}
	}

	for _, v := range vaults {
		rel, err := filepath.Rel(v.Path, path)
		if err != nil {
			continue
		}
		if !strings.HasPrefix(rel, "..") {
			return true
		}
		if path == filepath.Clean(v.Path) {
			return true
		}
	}
	return false
}

func isAllowedExistsCheck(path string) bool {
	return isWithinHome(path)
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func fsErr(msg, code, path string) map[string]any {
	return map[string]any{"error": msg, "code": code, "path": path}
}

func fsOK() map[string]bool { return map[string]bool{"ok": true} }

// getPath extracts the "path" field from the JSON body, falling back to
// query parameter.
func getPath(c *gin.Context) string {
	var b struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&b); err == nil && b.Path != "" {
		return b.Path
	}
	return c.Query("path")
}

// getVaultID extracts the vault ID from header or query parameter.
func getVaultID(c *gin.Context) string {
	if v := c.GetHeader("X-Vault-ID"); v != "" {
		return v
	}
	return c.Query("vault")
}

// ---------------------------------------------------------------------------
// Stat helper
// ---------------------------------------------------------------------------

func makeStat(info os.FileInfo) map[string]any {
	mode := int(info.Mode())
	return map[string]any{
		"isDirectory":    info.IsDir(),
		"isFile":         !info.IsDir() && info.Mode().IsRegular(),
		"isSymbolicLink": info.Mode()&os.ModeSymlink != 0,
		"size":           info.Size(),
		"mode":           mode,
		"mtime":          info.ModTime().UnixMilli(),
		"ctime":          info.ModTime().UnixMilli(),
		"atime":          info.ModTime().UnixMilli(),
		"blksize":        4096,
		"blocks":         (info.Size() + 511) / 512,
		"dev":            0,
		"ino":            0,
		"nlink":          1,
		"uid":            0,
		"gid":            0,
		"rdev":           0,
	}
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func FsExists(c *gin.Context) {
	p := getPath(c)
	vaultID := getVaultID(c)
	if !isAllowedPathForVault(p, vaultID) && !isAllowedExistsCheck(p) {
		c.JSON(http.StatusOK, map[string]bool{"exists": false})
		return
	}
	_, err := os.Stat(p)
	c.JSON(http.StatusOK, map[string]bool{"exists": err == nil})
}

func FsStat(c *gin.Context) {
	p := getPath(c)
	vaultID := getVaultID(c)
	if !isAllowedPathForVault(p, vaultID) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, stat '"+p+"'", "EACCES", p))
		return
	}
	info, err := os.Stat(p)
	if err != nil {
		code := "ENOENT"
		if !os.IsNotExist(err) {
			code = "EIO"
		}
		c.JSON(http.StatusOK, fsErr(err.Error(), code, p))
		return
	}
	c.JSON(http.StatusOK, makeStat(info))
}

func FsReaddir(c *gin.Context) {
	p := getPath(c)
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, readdir '"+p+"'", "EACCES", p))
		return
	}
	entries, err := os.ReadDir(p)
	if err != nil {
		code := "ENOENT"
		if !os.IsNotExist(err) {
			code = "EIO"
		}
		c.JSON(http.StatusOK, fsErr(err.Error(), code, p))
		return
	}

	var b struct {
		WithFileTypes bool `json:"withFileTypes"`
	}
	_ = c.ShouldBindJSON(&b)

	if b.WithFileTypes {
		dirents := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			dirents = append(dirents, map[string]any{
				"name":            e.Name(),
				"isFile":          e.Type().IsRegular(),
				"isDirectory":     e.IsDir(),
				"isSymbolicLink":  e.Type()&os.ModeSymlink != 0,
			})
		}
		c.JSON(http.StatusOK, map[string]any{"entries": dirents})
	} else {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() {
				name += "/"
			}
			names = append(names, name)
		}
		c.JSON(http.StatusOK, map[string]any{"entries": names})
	}
}

func FsRead(c *gin.Context) {
	var req struct {
		Path     string `json:"path"`
		Encoding string `json:"encoding"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" {
		req.Path = c.Query("path")
	}

	if !isAllowedPath(req.Path) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, open '"+req.Path+"'", "EACCES", req.Path))
		return
	}

	data, err := os.ReadFile(req.Path)
	if err != nil {
		code := "ENOENT"
		if !os.IsNotExist(err) {
			code = "EIO"
		}
		c.JSON(http.StatusOK, fsErr(err.Error(), code, req.Path))
		return
	}

	if req.Encoding != "" {
		c.JSON(http.StatusOK, map[string]string{"data": string(data)})
	} else {
		c.JSON(http.StatusOK, map[string]string{"base64": base64.StdEncoding.EncodeToString(data)})
	}
}

func FsWrite(c *gin.Context) {
	var b struct {
		Path   string `json:"path"`
		Base64 string `json:"base64"`
		Data   string `json:"data"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if b.Path == "" {
		b.Path = c.Query("path")
	}
	p := b.Path
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, open '"+p+"'", "EACCES", p))
		return
	}

	var payload []byte
	var err error
	if b.Base64 != "" {
		payload, err = base64.StdEncoding.DecodeString(b.Base64)
		if err != nil {
			c.JSON(http.StatusOK, fsErr("invalid base64: "+err.Error(), "EINVAL", p))
			return
		}
	} else if b.Data != "" {
		payload = []byte(b.Data)
	} else {
		payload, err = io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
			return
		}
	}

	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	if err := os.WriteFile(p, payload, 0o644); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsWriteRaw(c *gin.Context) {
	path := filepath.Clean(c.Query("path"))
	if path == "." {
		c.JSON(http.StatusOK, fsErr("path is required", "EINVAL", ""))
		return
	}
	if !isAllowedPath(path) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, open '"+path+"'", "EACCES", path))
		return
	}
	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", path))
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", path))
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", path))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsAppendFile(c *gin.Context) {
	var b struct {
		Path string `json:"path"`
		Data string `json:"data"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if b.Path == "" {
		b.Path = c.Query("path")
	}
	p := b.Path
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, open '"+p+"'", "EACCES", p))
		return
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	defer f.Close()
	if _, err := f.WriteString(b.Data); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsMkdir(c *gin.Context) {
	p := getPath(c)
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, mkdir '"+p+"'", "EACCES", p))
		return
	}
	if err := os.MkdirAll(p, 0o755); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsRename(c *gin.Context) {
	var b struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if !isAllowedPath(b.From) || !isAllowedPath(b.To) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied", "EACCES", b.From))
		return
	}
	if err := os.MkdirAll(filepath.Dir(b.To), 0o755); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", b.To))
		return
	}
	if err := os.Rename(b.From, b.To); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", b.From))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsUnlink(c *gin.Context) {
	p := getPath(c)
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, unlink '"+p+"'", "EACCES", p))
		return
	}
	if err := os.Remove(p); err != nil {
		code := "ENOENT"
		if !os.IsNotExist(err) {
			code = "EIO"
		}
		c.JSON(http.StatusOK, fsErr(err.Error(), code, p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsRmdir(c *gin.Context) {
	var b struct {
		Path      string `json:"path"`
		Recursive bool   `json:"recursive"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if b.Path == "" {
		b.Path = c.Query("path")
	}
	p := b.Path
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, rmdir '"+p+"'", "EACCES", p))
		return
	}
	var err2 error
	if b.Recursive {
		err2 = os.RemoveAll(p)
	} else {
		err2 = os.Remove(p)
	}
	if err2 != nil {
		code := "ENOENT"
		if !os.IsNotExist(err2) {
			code = "EIO"
		}
		c.JSON(http.StatusOK, fsErr(err2.Error(), code, p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsCopyFile(c *gin.Context) {
	var b struct {
		Src  string `json:"src"`
		Dest string `json:"dest"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if !isAllowedPath(b.Src) || !isAllowedPath(b.Dest) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied", "EACCES", b.Src))
		return
	}
	data, err := os.ReadFile(b.Src)
	if err != nil {
		code := "ENOENT"
		if !os.IsNotExist(err) {
			code = "EIO"
		}
		c.JSON(http.StatusOK, fsErr(err.Error(), code, b.Src))
		return
	}
	if err := os.MkdirAll(filepath.Dir(b.Dest), 0o755); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", b.Dest))
		return
	}
	if err := os.WriteFile(b.Dest, data, 0o644); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", b.Dest))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsAccess(c *gin.Context) {
	p := getPath(c)
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, access '"+p+"'", "EACCES", p))
		return
	}
	if _, err := os.Stat(p); err != nil {
		code := "ENOENT"
		if !os.IsNotExist(err) {
			code = "EIO"
		}
		c.JSON(http.StatusOK, fsErr(err.Error(), code, p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsRealpath(c *gin.Context) {
	p := getPath(c)
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, realpath '"+p+"'", "EACCES", p))
		return
	}
	resolved, err := filepath.EvalSymlinks(p)
	if err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "ENOENT", p))
		return
	}
	c.JSON(http.StatusOK, map[string]string{"path": resolved})
}

func FsReadlink(c *gin.Context) {
	p := getPath(c)
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, readlink '"+p+"'", "EACCES", p))
		return
	}
	target, err := os.Readlink(p)
	if err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", p))
		return
	}
	c.JSON(http.StatusOK, map[string]string{"target": target})
}

func FsSymlink(c *gin.Context) {
	var b struct {
		Path   string `json:"path"`
		Target string `json:"target"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if b.Path == "" {
		b.Path = c.Query("path")
	}
	p := b.Path
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, symlink '"+p+"'", "EACCES", p))
		return
	}
	if err := os.Symlink(b.Target, p); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsTruncate(c *gin.Context) {
	var b struct {
		Path string  `json:"path"`
		Len  float64 `json:"len"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if b.Path == "" {
		b.Path = c.Query("path")
	}
	p := b.Path
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, truncate '"+p+"'", "EACCES", p))
		return
	}
	if err := os.Truncate(p, int64(b.Len)); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsUtimes(c *gin.Context) {
	var b struct {
		Path  string  `json:"path"`
		Atime float64 `json:"atime"`
		Mtime float64 `json:"mtime"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if b.Path == "" {
		b.Path = c.Query("path")
	}
	p := b.Path
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, utimes '"+p+"'", "EACCES", p))
		return
	}
	var atime, mtime time.Time
	if b.Atime != 0 {
		atime = time.UnixMilli(int64(b.Atime))
	} else {
		atime = time.Now()
	}
	if b.Mtime != 0 {
		mtime = time.UnixMilli(int64(b.Mtime))
	} else {
		mtime = time.Now()
	}
	if err := os.Chtimes(p, atime, mtime); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsChmod(c *gin.Context) {
	var b struct {
		Path string  `json:"path"`
		Mode float64 `json:"mode"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EINVAL", ""))
		return
	}
	if b.Path == "" {
		b.Path = c.Query("path")
	}
	p := b.Path
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied, chmod '"+p+"'", "EACCES", p))
		return
	}
	mode := os.FileMode(0o644)
	if b.Mode != 0 {
		mode = os.FileMode(int(b.Mode))
	}
	if err := os.Chmod(p, mode); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func FsTrash(c *gin.Context) {
	p := getPath(c)
	if !isAllowedPath(p) {
		c.JSON(http.StatusOK, fsErr("EACCES: permission denied", "EACCES", p))
		return
	}
	if err := trashFile(p); err != nil {
		c.JSON(http.StatusOK, fsErr(err.Error(), "EIO", p))
		return
	}
	c.JSON(http.StatusOK, fsOK())
}

func trashFile(path string) error {
	switch runtime.GOOS {
	case "linux":
		return trashLinux(path)
	case "darwin":
		return trashDarwin(path)
	case "windows":
		return trashWindows(path)
	default:
		return os.RemoveAll(path)
	}
}

func trashLinux(path string) error {
	path, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	trashDir := filepath.Join(os.Getenv("HOME"), ".local", "share", "Trash")
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		trashDir = filepath.Join(xdg, "Trash")
	}
	filesDir := filepath.Join(trashDir, "files")
	infoDir := filepath.Join(trashDir, "info")

	if err := os.MkdirAll(filesDir, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(infoDir, 0o700); err != nil {
		return err
	}

	base := filepath.Base(path)
	destName := base
	for i := 1; ; i++ {
		if _, err := os.Stat(filepath.Join(filesDir, destName)); os.IsNotExist(err) {
			break
		}
		destName = fmt.Sprintf("%s.%d", base, i)
	}

	if err := os.Rename(path, filepath.Join(filesDir, destName)); err != nil {
		return trashCopyFallback(path, filesDir, destName)
	}

	info := fmt.Sprintf(
		"[Trash Info]\nPath=%s\nDeletionDate=%s\n",
		path,
		time.Now().Format("2006-01-02T15:04:05"),
	)
	return os.WriteFile(filepath.Join(infoDir, destName+".trashinfo"), []byte(info), 0o644)
}

func trashCopyFallback(path, filesDir, destName string) error {
	srcInfo, err := os.Stat(path)
	if err != nil {
		return err
	}
	destPath := filepath.Join(filesDir, destName)
	if srcInfo.IsDir() {
		if err := copyDir(path, destPath); err != nil {
			return err
		}
	} else {
		if err := copyFile(path, destPath); err != nil {
			return err
		}
	}
	return os.RemoveAll(path)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		s := filepath.Join(src, entry.Name())
		d := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := copyDir(s, d); err != nil {
				return err
			}
		} else {
			if err := copyFile(s, d); err != nil {
				return err
			}
		}
	}
	return nil
}

func trashDarwin(path string) error {
	escaped := strings.ReplaceAll(path, `"`, `\"`)
	script := fmt.Sprintf(
		`tell app "Finder" to delete POSIX file "%s"`,
		escaped,
	)
	return exec.Command("osascript", "-e", script).Run()
}

func trashWindows(path string) error {
	script := fmt.Sprintf(
		`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('%s','OnlyErrorDialogs','SendToRecycleBin')`,
		strings.ReplaceAll(path, "'", "''"),
	)
	return exec.Command("powershell", "-NoProfile", "-Command", script).Run()
}

// ---------------------------------------------------------------------------
// WebSocket dispatch — routes FS operations to the appropriate handler via
// a synthetic Gin context so the WSFS hub can reuse the same handler logic.
// ---------------------------------------------------------------------------

// FsDispatch handles the Gin route /api/fs/:op, dispatching to the
// appropriate Fs* handler based on the operation name.
func FsDispatch(c *gin.Context) {
	op := strings.TrimPrefix(c.Param("op"), "/")
	if op == "" {
		c.JSON(http.StatusBadRequest, fsErr("missing operation", "EINVAL", ""))
		return
	}

	// Attach vault ID from query param to header for downstream handlers
	if vaultID := c.Query("vault"); vaultID != "" {
		c.Request.Header.Set("X-Vault-ID", vaultID)
	}

	switch op {
	case "exists":
		FsExists(c)
	case "stat", "lstat":
		FsStat(c)
	case "readdir":
		FsReaddir(c)
	case "read", "readFile":
		FsRead(c)
	case "write", "writeFile":
		FsWrite(c)
	case "writeRaw":
		FsWriteRaw(c)
	case "appendFile":
		FsAppendFile(c)
	case "mkdir":
		FsMkdir(c)
	case "rename":
		FsRename(c)
	case "unlink":
		FsUnlink(c)
	case "rmdir":
		FsRmdir(c)
	case "copyFile":
		FsCopyFile(c)
	case "access":
		FsAccess(c)
	case "realpath":
		FsRealpath(c)
	case "readlink":
		FsReadlink(c)
	case "symlink":
		FsSymlink(c)
	case "truncate":
		FsTruncate(c)
	case "utimes":
		FsUtimes(c)
	case "chmod":
		FsChmod(c)
	case "trash":
		FsTrash(c)
	default:
		c.JSON(http.StatusBadRequest, fsErr("unknown operation: "+op, "ENOSYS", ""))
	}
}

// DispatchFSOp routes a file-system operation through the main gin engine so
// that no new engine (and no GIN debug warning) is created per call.
func DispatchFSOp(op string, body map[string]any, vaultID string) any {
	bodyBytes, _ := json.Marshal(body)

	url := "/api/fs/" + op
	if vaultID != "" {
		url += "?vault=" + vaultID
	}
	req, _ := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	if vaultID != "" {
		req.Header.Set("X-Vault-ID", vaultID)
	}
	// Attach session cookie so internal dispatch requests pass auth middleware.
	if authSessionValue != "" {
		req.AddCookie(&http.Cookie{Name: middleware.SessionCookie, Value: authSessionValue})
	}

	w := httptest.NewRecorder()
	dispatchEngine.ServeHTTP(w, req)

	var result any
	_ = json.NewDecoder(w.Body).Decode(&result)
	return result
}
