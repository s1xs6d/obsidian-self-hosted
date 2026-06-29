package handler

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
)

// devHub holds SSE clients connected to /dev/events.
// Only active when GIN_MODE != release.
var devHub = &devReloadHub{}

type devReloadHub struct {
	mu      sync.Mutex
	clients []chan struct{}
}

func (h *devReloadHub) subscribe() (ch chan struct{}, unsub func()) {
	ch = make(chan struct{}, 1)
	h.mu.Lock()
	h.clients = append(h.clients, ch)
	h.mu.Unlock()
	unsub = func() {
		h.mu.Lock()
		for i, c := range h.clients {
			if c == ch {
				h.clients = append(h.clients[:i], h.clients[i+1:]...)
				break
			}
		}
		h.mu.Unlock()
	}
	return
}

func (h *devReloadHub) broadcast() {
	h.mu.Lock()
	clients := make([]chan struct{}, len(h.clients))
	copy(clients, h.clients)
	h.mu.Unlock()
	for _, ch := range clients {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// DevEventsHandler streams SSE to browser tabs in dev mode.
// Each connected tab blocks here until a reload is broadcast.
func DevEventsHandler(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	ch, unsub := devHub.subscribe()
	defer unsub()

	fmt.Fprintf(c.Writer, "event: ping\ndata: connected\n\n")
	c.Writer.Flush()

	select {
	case <-ch:
		fmt.Fprintf(c.Writer, "event: reload\ndata: reload\n\n")
		c.Writer.Flush()
	case <-c.Request.Context().Done():
	}
}

// DevTriggerHandler is called by the dev script after each shim rebuild.
func DevTriggerHandler(c *gin.Context) {
	devHub.broadcast()
	c.Status(http.StatusNoContent)
}

// DevPingHandler lets the browser confirm the server is back up after a restart.
func DevPingHandler(c *gin.Context) {
	c.Status(http.StatusOK)
}
