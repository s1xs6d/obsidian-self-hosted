package ws

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

var errClose = errors.New("websocket close frame received")

const (
	wsOpText   = 1
	wsOpBinary = 2
	wsOpClose  = 8
	wsOpPing   = 9
	wsOpPong   = 10
)

// wsUpgrade performs the WebSocket handshake and returns the net.Conn,
// a buffered writer, and any error.
func wsUpgrade(w http.ResponseWriter, r *http.Request) (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return nil, nil, fmt.Errorf("hijacking not supported")
	}

	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		http.Error(w, "missing key", http.StatusBadRequest)
		return nil, nil, fmt.Errorf("missing Sec-WebSocket-Key")
	}

	conn, bufrw, err := hj.Hijack()
	if err != nil {
		return nil, nil, err
	}

	h := sha1.Sum([]byte(key + wsGUID))
	accept := base64.StdEncoding.EncodeToString(h[:])

	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"

	if _, err := bufrw.Writer.WriteString(resp); err != nil {
		conn.Close()
		return nil, nil, err
	}
	if err := bufrw.Writer.Flush(); err != nil {
		conn.Close()
		return nil, nil, err
	}

	return conn, bufrw, nil
}

// wsWriteFrame writes a single WebSocket data frame.
func wsWriteFrame(buf *bufio.ReadWriter, opcode byte, payload []byte) error {
	// FIN + opcode
	header := []byte{0x80 | opcode}

	length := len(payload)
	if length <= 125 {
		header = append(header, byte(length))
	} else if length <= 65535 {
		header = append(header, 126, byte(length>>8), byte(length))
	} else {
		header = append(header, 127,
			byte(length>>56), byte(length>>48), byte(length>>40), byte(length>>32),
			byte(length>>24), byte(length>>16), byte(length>>8), byte(length))
	}

	if _, err := buf.Writer.Write(header); err != nil {
		return err
	}
	if _, err := buf.Writer.Write(payload); err != nil {
		return err
	}
	return buf.Writer.Flush()
}

// wsReadFrame reads a single WebSocket frame. Client-to-server frames are
// masked — we unmask them automatically.
func wsReadFrame(reader io.Reader) (byte, []byte, error) {
	// Read header (first 2 bytes minimum)
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
		return 0, nil, err
	}

	opcode := header[0] & 0x0F
	masked := (header[1] & 0x80) != 0
	length := int64(header[1] & 0x7F)

	switch {
	case length == 126:
		buf := make([]byte, 2)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return 0, nil, err
		}
		length = int64(buf[0])<<8 | int64(buf[1])
	case length == 127:
		buf := make([]byte, 8)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return 0, nil, err
		}
		length = 0
		for i := 0; i < 8; i++ {
			length = (length << 8) | int64(buf[i])
		}
	}

	var maskKey [4]byte
	if masked {
		if _, err := io.ReadFull(reader, maskKey[:]); err != nil {
			return 0, nil, err
		}
	}

	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return 0, nil, err
	}

	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}

	if opcode == wsOpClose {
		return opcode, payload, errClose
	}

	return opcode, payload, nil
}

// wsWriteClose sends a close frame and verifies the response.
func wsWriteClose(buf *bufio.ReadWriter) error {
	if err := wsWriteFrame(buf, wsOpClose, nil); err != nil {
		return err
	}
	_, _, err := wsReadFrame(buf.Reader)
	return err
}

// IsWebSocketRequest returns true if the request has a WebSocket upgrade header.
func IsWebSocketRequest(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Connection"), "upgrade") &&
		strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}
