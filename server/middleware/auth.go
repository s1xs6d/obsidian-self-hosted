package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const SessionCookie = "osh_session"

// SessionValue derives the expected cookie value from the token.
// Using HMAC means the cookie is unforgeable without knowing the token.
func SessionValue(token string) string {
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte("osh-session-v1"))
	return hex.EncodeToString(mac.Sum(nil))
}

// TokenAuth returns auth middleware. When token is empty it is a no-op.
func TokenAuth(token string) gin.HandlerFunc {
	if token == "" {
		return func(c *gin.Context) { c.Next() }
	}
	expected := []byte(SessionValue(token))

	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// Skip auth for the login/logout routes and assets needed to render the login page.
		// /dev/* (only ever registered outside gin.ReleaseMode — never in production
		// builds) is exempt too: the dev script's own reload-trigger POST is a
		// same-machine, cookie-less request from esbuild's watch process, not a browser.
		if strings.HasPrefix(path, "/auth/") || path == "/app.css" || strings.HasPrefix(path, "/dev/") {
			c.Next()
			return
		}

		// Check session cookie
		if cookie, err := c.Cookie(SessionCookie); err == nil {
			if subtle.ConstantTimeCompare([]byte(cookie), expected) == 1 {
				c.Next()
				return
			}
		}

		// Check Authorization: Bearer header (for non-browser clients / scripts)
		if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			submitted := strings.TrimPrefix(auth, "Bearer ")
			if subtle.ConstantTimeCompare([]byte(submitted), []byte(token)) == 1 {
				c.Next()
				return
			}
		}

		// No valid auth — decide response based on path
		isAPI := strings.HasPrefix(path, "/api/") ||
			strings.HasPrefix(path, "/ipc/") ||
			strings.HasPrefix(path, "/ws") ||
			strings.HasPrefix(path, "/vault-files/")
		if isAPI {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		// Redirect browser requests to login page
		next := c.Request.URL.RequestURI()
		c.Redirect(http.StatusFound, "/auth/login?next="+next)
		c.Abort()
	}
}
