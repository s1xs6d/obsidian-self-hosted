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
		errHTML = `<p class="err">` + errMsg + `</p>`
	}
	html := `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OSH</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
     background:#1e1e2e;color:#cdd6f4;font-family:system-ui,sans-serif}
.card{background:#313244;border-radius:12px;padding:40px;width:100%;max-width:360px;
      box-shadow:0 8px 32px rgba(0,0,0,.4)}
h1{font-size:22px;margin-bottom:6px;color:#cba6f7;letter-spacing:-.5px}
.sub{font-size:13px;color:#a6adc8;margin-bottom:28px}
label{display:block;font-size:12px;color:#a6adc8;margin-bottom:6px}
input{width:100%;padding:10px 14px;border:1px solid #45475a;border-radius:8px;
      background:#1e1e2e;color:#cdd6f4;font-size:14px;outline:none}
input:focus{border-color:#cba6f7}
button{margin-top:16px;width:100%;padding:10px;border:none;border-radius:8px;
       background:#cba6f7;color:#1e1e2e;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#b4befe}
.err{margin-top:12px;font-size:13px;color:#f38ba8;text-align:center}
</style>
</head>
<body>
<div class="card">
  <h1>OSH</h1>
  <p class="sub">Obsidian Self-Hosted</p>
  <form method="post" action="/auth/login">
    <input type="hidden" name="next" value="` + next + `">
    <label for="pw">Password</label>
    <input type="password" id="pw" name="password" autofocus autocomplete="current-password" placeholder="Enter password">
    <button type="submit">Sign in</button>
  </form>` + errHTML + `
</div>
</body>
</html>`
	return []byte(html)
}
