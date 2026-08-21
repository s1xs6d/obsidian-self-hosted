package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"osh/config"
	"osh/handler"
	"osh/middleware"
	"osh/ws"
)

func main() {
	exeDir := executableDir()

	obsidianDir := flag.String(
		"obsidian-dir",
		envOr("OSH_OBSIDIAN_DIR", filepath.Join(exeDir, "static")),
		"Path to the unpacked Obsidian bundle (env: OSH_OBSIDIAN_DIR)",
	)
	staticDir := flag.String(
		"static-dir",
		envOr("OSH_STATIC_DIR", filepath.Join(exeDir, "static")),
		"Path to the static assets directory (env: OSH_STATIC_DIR)",
	)
	addr := flag.String("addr", envOr("OSH_ADDR", ":27123"), "TCP address for the HTTP server (env: OSH_ADDR)")
	flag.Parse()

	if err := config.Load(); err != nil {
		log.Printf("warning: could not load config: %v (starting with empty config)", err)
	}
	if err := config.LoadPolicy(); err != nil {
		log.Printf("warning: could not load policy: %v (using defaults)", err)
	}

	if v := bundleVersion(*obsidianDir); v != "" {
		config.SetVersion(v)
		log.Printf("Obsidian bundle version: %s", v)
	}

	oshToken := os.Getenv("OSH_TOKEN")
	handler.SetAuthToken(oshToken)

	hub := ws.NewWSHub()
	handler.SetHub(hub)

	handler.InitKeychain()
	handler.InitSecretStore()

	fsHub := ws.NewWSFSHub()
	terminalEnabled := os.Getenv("OSH_TERMINAL") == "true"
	execHub := ws.NewExecHub(terminalEnabled)

	staticHandler := handler.NewStaticHandler(*obsidianDir, *staticDir)

	r := gin.New()
	logger := middleware.NewLogger()
	r.Use(middleware.StructuredLogger(logger))
	r.Use(gin.Recovery())
	r.Use(middleware.TokenAuth(oshToken))

	handler.RegisterRoutes(r, staticHandler, hub, fsHub, execHub)
	handler.SetDispatchEngine(r)

	log.Printf("OSH server listening on %s", *addr)
	log.Printf("  obsidian dir : %s", *obsidianDir)
	log.Printf("  static dir   : %s", *staticDir)

	if err := r.Run(*addr); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func executableDir() string {
	exe, err := os.Executable()
	if err != nil {
		wd, _ := os.Getwd()
		return wd
	}
	return filepath.Dir(exe)
}

// bundleVersion reads the "version" field from the Obsidian bundle's
// package.json (e.g. <obsidian-dir>/package.json). Returns "" when the file
// is missing or unparseable.
func bundleVersion(obsidianDir string) string {
	data, err := os.ReadFile(filepath.Join(obsidianDir, "package.json"))
	if err != nil {
		return ""
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return ""
	}
	return pkg.Version
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
