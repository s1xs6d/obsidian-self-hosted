package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RegisterRoutes registers all HTTP routes on the given Gin engine.
func RegisterRoutes(r *gin.Engine, staticHandler *StaticHandler, hub http.Handler, fsHub http.Handler) {
	// ---- Auth ----
	r.GET("/auth/login", AuthLoginGet)
	r.POST("/auth/login", AuthLoginPost)
	r.GET("/auth/logout", AuthLogout)

	// ---- Static / HTML routes ----
	r.GET("/", staticHandler.GetRoot)
	r.GET("/starter", staticHandler.GetStarter)
	r.GET("/app", staticHandler.GetApp)
	r.GET("/help", staticHandler.GetHelp)
	r.GET("/electron-shim.js", staticHandler.GetShim)
	r.GET("/favicon.svg", staticHandler.GetFaviconSVG)
	r.GET("/favicon.ico", staticHandler.GetFaviconIco)

	// ---- IPC ----
	ipc := r.Group("/ipc")
	ipc.POST("/sync", SyncIPC)
	ipc.POST("/send", AsyncIPC)
	ipc.POST("/async", AsyncIPC)
	ipc.POST("/invoke", SyncIPC)
	ipc.POST("/host", AsyncIPC)

	// ---- File-system API ----
	fs := r.Group("/api/fs")
	fs.Any("/*op", FsDispatch)

	// ---- Directory browser ----
	browse := r.Group("/api/browse")
	browse.GET("", Browse)
	browse.POST("/rename", BrowseRename)
	browse.POST("/delete", BrowseDelete)
	browse.POST("/mkdir", BrowseMkdir)
	browse.POST("/copy", BrowseCopy)
	browse.GET("/download", BrowseDownload)
	browse.POST("/readfile", BrowseReadFile)
	browse.POST("/upload", BrowseUpload)

	// ---- Server-side HTTP proxy ----
	r.POST("/api/fetch", FetchProxy)

	// ---- Server config (home dir, etc.) ----
	r.GET("/api/config", ConfigHandler)

	// ---- Custom app icon ----
	r.GET("/api/icon", IconHandler)
	r.POST("/api/icon", IconSaveHandler)
	r.GET("/api/icon-meta", IconMetaHandler)

	// ---- Native OS operations ----
	r.POST("/api/native/open-directory", OpenDirectory)
	r.POST("/api/native/open-file", OpenFile)
	r.POST("/api/native/save-dialog", NativeStub)
	r.POST("/api/native/show-item", NativeStub)
	r.POST("/api/native/open-path", NativeStub)

	// ---- Vault file serving ----
	r.GET("/vault-files/*path", VaultFiles)

	// ---- Keychain (safe-storage) ----
	r.GET("/api/safe-storage/status", SafeStorageStatusHandler)
	r.POST("/api/safe-storage/encrypt", SafeStorageEncryptHandler)
	r.POST("/api/safe-storage/decrypt", SafeStorageDecryptHandler)

	// ---- Secret key-value store ----
	r.POST("/api/secret-storage/set", SecretStorageSetHandler)
	r.POST("/api/secret-storage/get", SecretStorageGetHandler)
	r.POST("/api/secret-storage/delete", SecretStorageDeleteHandler)
	r.POST("/api/secret-storage/list", SecretStorageListHandler)

	// ---- WebSocket (wrapped with gin.WrapH so the existing http.Handler works) ----
	r.GET("/ws", gin.WrapH(hub))
	r.GET("/ws-fs", gin.WrapH(fsHub))

	// ---- Dev live-reload (debug mode only, never active in production) ----
	if gin.Mode() != gin.ReleaseMode {
		r.GET("/dev/events", DevEventsHandler)
		r.POST("/dev/reload-trigger", DevTriggerHandler)
		r.GET("/dev/ping", DevPingHandler)
	}

	// ---- Catch-all: serve files from obsidian bundle ----
	r.NoRoute(staticHandler.ServeObsidianFile)
}
