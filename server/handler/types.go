package handler

// Broadcaster can push events to connected IPC WebSocket clients.
type Broadcaster interface {
	// Push broadcasts to every connected client.
	Push(channel string, payload any)
}

// hub is the active Broadcaster instance, set by SetHub during startup.
var hub Broadcaster

// SetHub registers the active WebSocket hub so IPC dispatch can push events.
func SetHub(h Broadcaster) {
	hub = h
}
