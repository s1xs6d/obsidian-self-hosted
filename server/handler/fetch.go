package handler

import (
	"bytes"
	"encoding/base64"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

type fetchRequest struct {
	URL         string            `json:"url"`
	Method      string            `json:"method"`
	Headers     map[string]string `json:"headers"`
	ContentType string            `json:"contentType"`
	Body        string            `json:"body"`
	BodyBase64  string            `json:"bodyBase64"`
}

type fetchResponse struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Text    string            `json:"text,omitempty"`
	Base64  string            `json:"base64,omitempty"`
	Binary  bool              `json:"binary,omitempty"`
}

type fetchError struct {
	Error string `json:"error"`
}

func isPrivateURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return true
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return true
	}
	host := u.Hostname()
	lower := strings.ToLower(host)
	if lower == "localhost" || strings.HasSuffix(lower, ".local") || strings.HasSuffix(lower, ".internal") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

var fetchClient = &http.Client{
	Timeout: 120 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

func FetchProxy(c *gin.Context) {
	var req fetchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, fetchError{Error: "bad request: " + err.Error()})
		return
	}

	if req.URL == "" {
		c.JSON(http.StatusOK, fetchError{Error: "url is required"})
		return
	}

	if isPrivateURL(req.URL) {
		c.JSON(http.StatusForbidden, gin.H{"error": "requests to private addresses are not allowed"})
		return
	}

	method := strings.ToUpper(req.Method)
	if method == "" {
		method = http.MethodGet
	}

	var body io.Reader
	if req.BodyBase64 != "" {
		b, err := base64.StdEncoding.DecodeString(req.BodyBase64)
		if err != nil {
			c.JSON(http.StatusOK, fetchError{Error: "invalid bodyBase64: " + err.Error()})
			return
		}
		body = bytes.NewReader(b)
	} else if req.Body != "" {
		body = strings.NewReader(req.Body)
	}

	outReq, err := http.NewRequestWithContext(c.Request.Context(), method, req.URL, body)
	if err != nil {
		c.JSON(http.StatusOK, fetchError{Error: err.Error()})
		return
	}

	for k, v := range req.Headers {
		outReq.Header.Set(k, v)
	}
	if req.ContentType != "" {
		outReq.Header.Set("Content-Type", req.ContentType)
	}

	log.Printf("[fetch] → %s %s", method, req.URL)
	resp, err := fetchClient.Do(outReq)
	if err != nil {
		log.Printf("[fetch] ✗ %s: %v", req.URL, err)
		c.JSON(http.StatusOK, fetchError{Error: err.Error()})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[fetch] ✗ read body %s: %v", req.URL, err)
		c.JSON(http.StatusOK, fetchError{Error: "reading response: " + err.Error()})
		return
	}
	log.Printf("[fetch] ← %d %s (%d bytes)", resp.StatusCode, req.URL, len(respBody))

	headers := make(map[string]string, len(resp.Header))
	for k, vs := range resp.Header {
		headers[strings.ToLower(k)] = strings.Join(vs, ", ")
	}

	ct := resp.Header.Get("Content-Type")
	isText := isTextContentType(ct) || utf8.Valid(respBody)

	var rsp fetchResponse
	rsp.Status = resp.StatusCode
	rsp.Headers = headers
	if isText {
		rsp.Text = string(respBody)
	} else {
		rsp.Base64 = base64.StdEncoding.EncodeToString(respBody)
		rsp.Binary = true
	}
	c.JSON(http.StatusOK, rsp)
}

func isTextContentType(ct string) bool {
	if ct == "" {
		return true
	}
	ct = strings.ToLower(strings.SplitN(ct, ";", 2)[0])
	ct = strings.TrimSpace(ct)
	switch ct {
	case "application/json", "application/javascript", "application/x-javascript",
		"application/xml", "application/x-www-form-urlencoded", "application/graphql":
		return true
	}
	return strings.HasPrefix(ct, "text/")
}
