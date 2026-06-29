package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"osh/config"
)

// ConfigHandler returns server-side configuration that the client shim needs at
// runtime — currently just the browse root (OSH_HOME).
func ConfigHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"home": config.HomeDir(),
	})
}
