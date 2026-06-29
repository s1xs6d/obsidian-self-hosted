package handler

import (
	"bytes"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"osh/config"
)

// StaticHandler serves Obsidian's bundled assets from obsidianDir, injecting
// the Electron shim into every HTML response.
type StaticHandler struct {
	obsidianDir string
	staticDir   string
}

func NewStaticHandler(obsidianDir, staticDir string) *StaticHandler {
	obsidianAbs, _ := filepath.Abs(obsidianDir)
	staticAbs, _ := filepath.Abs(staticDir)
	return &StaticHandler{
		obsidianDir: obsidianAbs,
		staticDir:   staticAbs,
	}
}

func (h *StaticHandler) GetRoot(c *gin.Context) {
	c.Redirect(http.StatusFound, "/starter")
}

func (h *StaticHandler) GetStarter(c *gin.Context) {
	h.serveObsidianHTML(c, "starter.html")
}

func (h *StaticHandler) GetApp(c *gin.Context) {
	h.serveObsidianHTML(c, "index.html")
}

func (h *StaticHandler) GetHelp(c *gin.Context) {
	h.serveObsidianHTML(c, "help.html")
}

func (h *StaticHandler) GetShim(c *gin.Context) {
	fullPath := filepath.Join(h.staticDir, "electron-shim.js")
	info, err := os.Stat(fullPath)
	if err != nil {
		c.String(http.StatusNotFound, "shim not found: electron-shim.js")
		return
	}
	f, err := os.Open(fullPath)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	defer f.Close()
	c.Header("Content-Type", "application/javascript; charset=utf-8")
	http.ServeContent(c.Writer, c.Request, "electron-shim.js", info.ModTime(), f)
}

func (h *StaticHandler) GetFaviconSVG(c *gin.Context) {
	svgPath := filepath.Join(h.staticDir, "favicon.svg")
	if info, err := os.Stat(svgPath); err == nil {
		f, err := os.Open(svgPath)
		if err == nil {
			defer f.Close()
			c.Header("Content-Type", "image/svg+xml")
			c.Header("Cache-Control", "public, max-age=86400")
			http.ServeContent(c.Writer, c.Request, "favicon.svg", info.ModTime(), f)
			return
		}
	}
	c.Redirect(http.StatusFound, "/icon.png")
}

func (h *StaticHandler) GetFaviconIco(c *gin.Context) {
	c.Redirect(http.StatusMovedPermanently, "/icon.png")
}

// ServeObsidianFile is the fallback handler (NoRoute). It serves files from
// the Obsidian bundle directory, with shim injection for HTML files and
// support for absolute-path vault asset serving.
func (h *StaticHandler) ServeObsidianFile(c *gin.Context) {
	p := c.Request.URL.Path

	// Try absolute-path vault assets first.
	if isWithinHome(p) {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			h.serveLocalFile(c, p, info)
			return
		}
	}

	// Serve from Obsidian bundle directory.
	rel := filepath.FromSlash(strings.TrimPrefix(p, "/"))
	fullPath := filepath.Join(h.obsidianDir, rel)

	if !strings.HasPrefix(fullPath+string(os.PathSeparator), h.obsidianDir+string(os.PathSeparator)) &&
		fullPath != h.obsidianDir {
		c.String(http.StatusForbidden, "forbidden")
		return
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}

	if info.IsDir() {
		fullPath = filepath.Join(fullPath, "index.html")
		if _, err := os.Stat(fullPath); err != nil {
			c.String(http.StatusNotFound, "not found")
			return
		}
		info, _ = os.Stat(fullPath)
	}

	if strings.HasSuffix(strings.ToLower(fullPath), ".html") {
		data, err := os.ReadFile(fullPath)
		if err != nil {
			c.String(http.StatusNotFound, "not found")
			return
		}
		data = injectShims(data)
		data = injectFavicon(data)
		setSecurityHeaders(c)
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Header("Cache-Control", "no-cache")
		c.Writer.WriteHeader(http.StatusOK)
		_, _ = c.Writer.Write(data)
		return
	}

	f, err := os.Open(fullPath)
	if err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	defer f.Close()

	if ct := mime.TypeByExtension(filepath.Ext(fullPath)); ct != "" {
		c.Header("Content-Type", ct)
	}
	http.ServeContent(c.Writer, c.Request, filepath.Base(fullPath), info.ModTime(), f)
}

func (h *StaticHandler) serveObsidianHTML(c *gin.Context, filename string) {
	fullPath := filepath.Join(h.obsidianDir, filename)
	data, err := os.ReadFile(fullPath)
	if err != nil {
		c.String(http.StatusNotFound, "not found: "+filename)
		return
	}
	data = injectShims(data)
	data = injectFavicon(data)
	data = injectDevReload(data)
	data = relaxCSP(data)
	setSecurityHeaders(c)
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Writer.WriteHeader(http.StatusOK)
	_, _ = c.Writer.Write(data)
}

func setSecurityHeaders(c *gin.Context) {
	host := c.Request.Host
	isSecure := c.Request.TLS != nil ||
		strings.HasPrefix(host, "localhost") ||
		strings.HasPrefix(host, "127.0.0.1") ||
		strings.HasPrefix(host, "[::1]")

	if isSecure {
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		c.Header("Cross-Origin-Embedder-Policy", "require-corp")
	}
	c.Header("Access-Control-Allow-Origin", "*")
}

func relaxCSP(html []byte) []byte {
	const oldCSP = `content="style-src 'unsafe-inline' 'self' https://fonts.googleapis.com"`
	const newCSP = `content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"`
	return bytes.ReplaceAll(html, []byte(oldCSP), []byte(newCSP))
}

func (h *StaticHandler) serveLocalFile(c *gin.Context, absPath string, info os.FileInfo) {
	f, err := os.Open(absPath)
	if err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	defer f.Close()
	if ct := mime.TypeByExtension(filepath.Ext(absPath)); ct != "" {
		c.Header("Content-Type", ct)
	}
	c.Header("Access-Control-Allow-Origin", "*")
	http.ServeContent(c.Writer, c.Request, filepath.Base(absPath), info.ModTime(), f)
}

// VaultFiles serves files stored inside a registered vault.
// URL format: /vault-files/{vaultId}/{relative/path/to/file}
func VaultFiles(c *gin.Context) {
	trimmed := strings.TrimPrefix(c.Request.URL.Path, "/vault-files/")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		c.String(http.StatusBadRequest, "invalid vault-files path")
		return
	}

	vaultID := parts[0]
	relPath := parts[1]

	vaultPath, ok := config.VaultByID(vaultID)
	if !ok {
		c.String(http.StatusNotFound, "vault not found")
		return
	}

	fullPath := filepath.Join(vaultPath, filepath.FromSlash(relPath))

	if !strings.HasPrefix(fullPath+string(os.PathSeparator), vaultPath+string(os.PathSeparator)) {
		c.String(http.StatusForbidden, "forbidden")
		return
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}

	f, err := os.Open(fullPath)
	if err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	defer f.Close()

	http.ServeContent(c.Writer, c.Request, filepath.Base(fullPath), info.ModTime(), f)
}

// ---------------------------------------------------------------------------
// Shim injection helpers
// ---------------------------------------------------------------------------

const shimTag = "\n<script src=\"/electron-shim.js\"></script>\n"

const faviconTags = "\n<link rel=\"icon\" type=\"image/svg+xml\" href=\"/favicon.svg\">" +
	"\n<link rel=\"icon\" type=\"image/png\" href=\"/icon.png\">" +
	"\n<link rel=\"apple-touch-icon\" href=\"/icon.png\">\n"

// devReloadTag is injected into every HTML page in dev (non-release) mode.
//
// On shim rebuild (event: reload): close the SSE connection immediately (to
// prevent onerror firing when the server closes it), then fetch + eval the new
// electron-shim.js in place (HMR). Reconnect SSE after eval so the next change
// is also picked up without a reload.
//
// On server restart (SSE onerror without prior reload): Go restarted, so full
// page reload is needed — poll /dev/ping until the server is up, then reload.
const devReloadTag = "\n<script>" +
	"(function(){" +
	"function connect(){" +
	"var evs=new EventSource('/dev/events');" +
	"var handled=false;" +
	"evs.addEventListener('reload',function(){" +
	"handled=true;" +
	"evs.close();" + // close now — prevents onerror from firing when server closes its side
	"fetch('/electron-shim.js?_='+Date.now())" +
	".then(function(r){return r.text();})" +
	".then(function(code){" +
	"try{(0,eval)(code);}catch(err){location.reload();return;}" +
	"var api=window.__oshObsAPI;" +
	"if(api&&typeof api.Notice==='function'){try{new api.Notice('Reload Finished');}catch(_){}}" +
	"setTimeout(connect,100);" + // reconnect SSE for the next change
	"})" +
	".catch(function(){location.reload();});" +
	"});" +
	"evs.onerror=function(){" +
	"if(handled)return;" + // we already closed it ourselves
	"evs.close();(function r(){" +
	"fetch('/dev/ping').then(function(){location.reload()}).catch(function(){setTimeout(r,3000)});" +
	"})();};" +
	"}" +
	"connect();" +
	"})();" +
	"</script>\n"

func injectFavicon(html []byte) []byte {
	lower := bytes.ToLower(html)
	if pos := findTagClose(lower, []byte("<head")); pos >= 0 {
		return spliceAt(html, pos, []byte(faviconTags))
	}
	return html
}

func injectDevReload(html []byte) []byte {
	if gin.Mode() == gin.ReleaseMode {
		return html
	}
	lower := bytes.ToLower(html)
	if pos := findTagClose(lower, []byte("<head")); pos >= 0 {
		return spliceAt(html, pos, []byte(devReloadTag))
	}
	return html
}

func injectShims(html []byte) []byte {
	lower := bytes.ToLower(html)
	tag := []byte(shimTag)

	if pos := findTagClose(lower, []byte("<head")); pos >= 0 {
		return spliceAt(html, pos, tag)
	}

	if idx := bytes.Index(lower, []byte("<script")); idx >= 0 {
		return spliceAt(html, idx, tag)
	}

	if pos := findTagClose(lower, []byte("<body")); pos >= 0 {
		return spliceAt(html, pos, tag)
	}

	return html
}

func findTagClose(lower, prefix []byte) int {
	idx := bytes.Index(lower, prefix)
	if idx < 0 {
		return -1
	}
	closeIdx := bytes.IndexByte(lower[idx:], '>')
	if closeIdx < 0 {
		return -1
	}
	return idx + closeIdx + 1
}

func spliceAt(src []byte, pos int, ins []byte) []byte {
	out := make([]byte, 0, len(src)+len(ins))
	out = append(out, src[:pos]...)
	out = append(out, ins...)
	out = append(out, src[pos:]...)
	return out
}
