package ws

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"osh/handler"
)

// ---------------------------------------------------------------------------
// WSHub — IPC event hub
// ---------------------------------------------------------------------------

type ipcClient struct {
	vaultID string
	send    chan []byte
	hub     *WSHub
}

// WSHub manages WebSocket connections for IPC events. It implements the
// Broadcaster interface so handler dispatch functions can push events.
type WSHub struct {
	mu      sync.RWMutex
	clients map[*ipcClient]struct{}
}

// NewWSHub creates an initialised WSHub.
func NewWSHub() *WSHub {
	return &WSHub{clients: make(map[*ipcClient]struct{})}
}

// Push broadcasts an event to every connected IPC client.
func (h *WSHub) Push(channel string, payload any) {
	data, err := json.Marshal(map[string]any{
		"type":    "event",
		"channel": channel,
		"payload": payload,
	})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- data:
		default:
		}
	}
}

// ServeHTTP upgrades the connection to WebSocket and handles IPC messages.
func (h *WSHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !IsWebSocketRequest(r) {
		http.Error(w, "websocket required", http.StatusUpgradeRequired)
		return
	}

	conn, buf, err := wsUpgrade(w, r)
	if err != nil {
		return
	}
	defer conn.Close()

	vaultID := r.URL.Query().Get("vault")

	client := &ipcClient{
		vaultID: vaultID,
		send:    make(chan []byte, 256),
		hub:     h,
	}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients, client)
		h.mu.Unlock()
	}()

	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case msg, ok := <-client.send:
				if !ok {
					return
				}
				if err := wsWriteFrame(buf, wsOpText, msg); err != nil {
					return
				}
				_ = buf.Writer.Flush()
			case <-ticker.C:
				if err := wsWriteFrame(buf, wsOpText, []byte(`{"type":"ping"}`)); err != nil {
					return
				}
				_ = buf.Writer.Flush()
			}
		}
	}()

	type ipcReq struct {
		Type    string `json:"type"`
		ID      string `json:"id"`
		Channel string `json:"channel"`
		Args    []any  `json:"args"`
		Vault   string `json:"vault"`
	}

	for {
		opcode, payload, err := wsReadFrame(buf.Reader)
		if err != nil {
			break
		}
		switch opcode {
		case wsOpText, wsOpBinary:
			var req ipcReq
			if err := json.Unmarshal(payload, &req); err != nil {
				continue
			}
			vault := req.Vault
			if vault == "" {
				vault = vaultID
			}
			if req.Type == "invoke" {
				result, err := handler.DispatchSync(req.Channel, req.Args, vault)
				if err == nil {
					client.enqueue(map[string]any{
						"type":   "result",
						"id":     req.ID,
						"result": result,
					})
				}
			} else if req.Type == "invoke-async" {
				handler.DispatchAsync(req.Channel, req.Args, vault)
				client.enqueue(map[string]any{
					"type": "ack",
					"id":   req.ID,
				})
			}

		case wsOpClose:
			_ = wsWriteClose(buf)
			goto exit

		case wsOpPing:
			_ = wsWriteFrame(buf, wsOpPong, payload)
			_ = buf.Writer.Flush()
		}
	}

exit:
	close(client.send)
	<-done
}

func (c *ipcClient) enqueue(msg any) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

// ---------------------------------------------------------------------------
// WSFSHub — file-system WebSocket hub
// ---------------------------------------------------------------------------

type wsFSClient struct {
	send chan []byte
}

// WSFSHub manages WebSocket connections dedicated to file-system operations.
type WSFSHub struct {
	mu      sync.RWMutex
	clients map[*wsFSClient]struct{}
}

// fsOpSem limits the number of concurrent FS goroutines spawned by WSFSHub to
// prevent goroutine storms when Obsidian opens a large vault.
var fsOpSem = make(chan struct{}, 64)

// NewWSFSHub creates an initialised WSFSHub.
func NewWSFSHub() *WSFSHub {
	return &WSFSHub{clients: make(map[*wsFSClient]struct{})}
}

// ServeHTTP upgrades the connection to WebSocket and handles FS messages.
func (h *WSFSHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !IsWebSocketRequest(r) {
		http.Error(w, "websocket required", http.StatusUpgradeRequired)
		return
	}

	conn, buf, err := wsUpgrade(w, r)
	if err != nil {
		return
	}
	defer conn.Close()

	vaultID := r.URL.Query().Get("vault")

	client := &wsFSClient{send: make(chan []byte, 128)}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients, client)
		h.mu.Unlock()
	}()

	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case msg, ok := <-client.send:
				if !ok {
					return
				}
				if err := wsWriteFrame(buf, wsOpText, msg); err != nil {
					return
				}
				_ = buf.Writer.Flush()
			case <-ticker.C:
				if err := wsWriteFrame(buf, wsOpText, []byte(`{"type":"ping"}`)); err != nil {
					return
				}
				_ = buf.Writer.Flush()
			}
		}
	}()

	type fsReq struct {
		Type    string         `json:"type"`
		ID      string         `json:"id"`
		Op      string         `json:"op"`
		Payload map[string]any `json:"payload"`
		Vault   string         `json:"vault"`
	}

	for {
		opcode, payload, err := wsReadFrame(buf.Reader)
		if err != nil {
			break
		}
		switch opcode {
		case wsOpText, wsOpBinary:
			var req fsReq
			if err := json.Unmarshal(payload, &req); err != nil {
				continue
			}
			vault := req.Vault
			if vault == "" {
				vault = vaultID
			}
			if req.Type == "invoke" {
				go func(id, op string, body map[string]any, vault string) {
					fsOpSem <- struct{}{}
					defer func() { <-fsOpSem }()
					result := handler.DispatchFSOp(op, body, vault)
					client.enqueue(map[string]any{"type": "result", "id": id, "result": result})
				}(req.ID, req.Op, req.Payload, vault)
			}

		case wsOpClose:
			_ = wsWriteClose(buf)
			goto exitfs

		case wsOpPing:
			_ = wsWriteFrame(buf, wsOpPong, payload)
			_ = buf.Writer.Flush()
		}
	}

exitfs:
	close(client.send)
	<-done
}

func (c *wsFSClient) enqueue(msg any) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}
