package handler

import (
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"

	"osh/config"
)

type browseEntry struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size,omitempty"`
	ModTime int64  `json:"mtime,omitempty"`
}

type browseResult struct {
	Path    string        `json:"path"`
	Parent  string        `json:"parent"`
	Home    string        `json:"home"`
	Entries []browseEntry `json:"entries"`
	Error   string        `json:"error,omitempty"`
}

// isWithinHome checks that p is within (or equal to) the OSH_HOME root.
func isWithinHome(p string) bool {
	home := config.HomeDir()
	if home == "" || !filepath.IsAbs(p) {
		return false
	}
	p = filepath.Clean(p)
	rel, err := filepath.Rel(home, p)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(rel, "..")
}

func Browse(c *gin.Context) {
	home := config.HomeDir()
	path := c.Query("path")
	if path == "" {
		path = home
	}
	path = filepath.Clean(path)

	// Clamp to home — if someone requests a path above home, silently redirect.
	if !isWithinHome(path) {
		path = home
	}

	parent := filepath.Dir(path)
	if parent == path || !isWithinHome(parent) {
		parent = ""
	}

	showHidden := c.Query("hidden") == "1"

	entries, err := os.ReadDir(path)
	if err != nil {
		c.JSON(http.StatusOK, browseResult{
			Path: path, Parent: parent, Home: home, Error: err.Error(),
			Entries: []browseEntry{},
		})
		return
	}

	var result []browseEntry
	for _, e := range entries {
		name := e.Name()
		if !showHidden && strings.HasPrefix(name, ".") {
			continue
		}
		be := browseEntry{Name: name, IsDir: e.IsDir()}
		if !e.IsDir() {
			if info, err2 := e.Info(); err2 == nil {
				be.Size = info.Size()
				be.ModTime = info.ModTime().UnixMilli()
			}
		}
		result = append(result, be)
	}

	sort.SliceStable(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	c.JSON(http.StatusOK, browseResult{Path: path, Parent: parent, Home: home, Entries: result})
}

func BrowseRename(c *gin.Context) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	body.From = filepath.Clean(body.From)
	body.To = filepath.Clean(body.To)
	if !isWithinHome(body.From) || !isWithinHome(body.To) {
		c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
		return
	}
	if err := os.Rename(body.From, body.To); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func BrowseDelete(c *gin.Context) {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	body.Path = filepath.Clean(body.Path)
	if !isWithinHome(body.Path) {
		c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
		return
	}
	info, err := os.Stat(body.Path)
	if err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	if info.IsDir() {
		err = os.RemoveAll(body.Path)
	} else {
		err = os.Remove(body.Path)
	}
	if err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func BrowseReadFile(c *gin.Context) {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	body.Path = filepath.Clean(body.Path)
	if !isWithinHome(body.Path) {
		c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
		return
	}
	data, err := os.ReadFile(body.Path)
	if err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]string{"base64": base64.StdEncoding.EncodeToString(data)})
}

func BrowseMkdir(c *gin.Context) {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	body.Path = filepath.Clean(body.Path)
	if !isWithinHome(body.Path) {
		c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
		return
	}
	if err := os.Mkdir(body.Path, 0o755); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func BrowseCopy(c *gin.Context) {
	var body struct {
		Src  string `json:"src"`
		Dest string `json:"dest"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	body.Src = filepath.Clean(body.Src)
	body.Dest = filepath.Clean(body.Dest)
	if !isWithinHome(body.Src) || !isWithinHome(body.Dest) {
		c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
		return
	}
	if err := browseCopyPath(body.Src, body.Dest); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func browseCopyPath(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return browseCopyDir(src, dst)
	}
	return browseCopyFile(src, dst)
}

func browseCopyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func browseCopyDir(src, dst string) error {
	if err := os.Mkdir(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := browseCopyPath(filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func BrowseDownload(c *gin.Context) {
	path := filepath.Clean(c.Query("path"))
	if path == "." || !isWithinHome(path) {
		c.String(http.StatusForbidden, "access denied")
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		c.String(http.StatusNotFound, "not found")
		return
	}
	c.Header("Content-Disposition", `attachment; filename="`+filepath.Base(path)+`"`)
	c.File(path)
}

func BrowseUpload(c *gin.Context) {
	dir := filepath.Clean(c.Query("dir"))
	if dir == "." || !isWithinHome(dir) {
		c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}

	var uploaded []string
	var errs []string

	for _, fhs := range form.File {
		for _, fh := range fhs {
			baseName := filepath.Base(fh.Filename)
			if baseName == "" || baseName == "." {
				continue
			}
			dest := filepath.Join(dir, baseName)
			if !isWithinHome(dest) {
				errs = append(errs, fh.Filename+": access denied")
				continue
			}
			if err := c.SaveUploadedFile(fh, dest); err != nil {
				errs = append(errs, fh.Filename+": "+err.Error())
				continue
			}
			uploaded = append(uploaded, baseName)
		}
	}

	resp := map[string]any{"ok": len(errs) == 0, "uploaded": uploaded}
	if len(errs) > 0 {
		resp["errors"] = errs
	}
	c.JSON(http.StatusOK, resp)
}
