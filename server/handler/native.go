package handler

import (
	"fmt"
	"net/http"
	"os/exec"
	"runtime"

	"github.com/gin-gonic/gin"
)

func OpenDirectory(c *gin.Context) {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", body.Path)
	case "windows":
		cmd = exec.Command("explorer", body.Path)
	default:
		cmd = exec.Command("xdg-open", body.Path)
	}

	if err := cmd.Start(); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]string{"ok": "opened"})
}

func OpenFile(c *gin.Context) {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}

	cmd := exec.Command("open", body.Path)
	if runtime.GOOS == "windows" {
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", body.Path)
	}
	if err := cmd.Start(); err != nil {
		c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, map[string]string{"ok": "opened"})
}

func NativeStub(c *gin.Context) {
	c.JSON(http.StatusOK, map[string]any{
		"ok":   true,
		"note": fmt.Sprintf("stub for %s", c.Request.URL.Path),
	})
}
