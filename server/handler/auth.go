package handler

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"osh/middleware"
)

var authToken string        // set by SetAuthToken at startup
var authSessionValue string // derived session cookie value; used by DispatchFSOp for internal requests

func SetAuthToken(token string) {
	authToken = token
	if token != "" {
		authSessionValue = middleware.SessionValue(token)
	}
}

func AuthLoginGet(c *gin.Context) {
	next := c.Query("next")
	if next == "" {
		next = "/"
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", loginPageHTML(next))
}

func AuthLoginPost(c *gin.Context) {
	submitted := c.PostForm("password")
	next := c.PostForm("next")
	if next == "" || !strings.HasPrefix(next, "/") {
		next = "/"
	}

	if authToken == "" || subtle.ConstantTimeCompare([]byte(submitted), []byte(authToken)) == 1 {
		c.SetCookie(middleware.SessionCookie, middleware.SessionValue(authToken), 86400*30, "/", "", false, true)
		c.Redirect(http.StatusFound, next)
		return
	}

	// Wrong password — re-render login with error
	c.Data(http.StatusUnauthorized, "text/html; charset=utf-8", loginPageHTMLWithError(next))
}

func AuthLogout(c *gin.Context) {
	c.SetCookie(middleware.SessionCookie, "", -1, "/", "", false, true)
	c.Redirect(http.StatusFound, "/auth/login")
}

func loginPageHTML(next string) []byte {
	return loginPage(next, "")
}

func loginPageHTMLWithError(next string) []byte {
	return loginPage(next, "Incorrect password.")
}

func loginPage(next, errMsg string) []byte {
	errHTML := ""
	if errMsg != "" {
		errHTML = `<div class="mod-warning-message"><p>` + errMsg + `</p></div>`
	}
	html := `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OSH</title>
<link rel="stylesheet" href="/app.css">
<style>
html,body{height:100%;margin:0}
.modal-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:var(--layer-modal,100)}
.modal-title{text-align:left}
</style>
</head>
<body>
<script>document.body.classList.add(matchMedia('(prefers-color-scheme:dark)').matches?'theme-dark':'theme-light')</script>
<div class="modal-container mod-dim">
<div class="modal-bg"></div>
<div class="modal" style="--dialog-width:360px;--dialog-max-width:92vw;--dialog-max-height:unset;position:relative">
  <div class="modal-title">OSH</div>
  <form method="post" action="/auth/login">
    <input type="hidden" name="next" value="` + next + `">
    <div class="modal-content">
      <div class="setting-item">
        <div class="setting-item-description">Enter password to access your vault.</div>
        <input type="password" name="password" autofocus autocomplete="current-password" placeholder="Password">
      </div>` + errHTML + `
    </div>
    <div class="modal-button-container">
      <button type="submit" class="mod-cta">Sign in</button>
    </div>
  </form>
</div>
</div>
</body>
</html>`
	return []byte(html)
}
