package ws

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"osh/config"
)

// ExecHub handles WebSocket connections for remote process execution.
// Only `git` commands are permitted and cwd must be within OSH_HOME.
type ExecHub struct{}

// NewExecHub creates an ExecHub.
func NewExecHub() *ExecHub { return &ExecHub{} }

type execSpawnReq struct {
	Cmd  string            `json:"cmd"`
	Args []string          `json:"args"`
	Cwd  string            `json:"cwd"`
	Env  map[string]string `json:"env"`
}

type execClientMsg struct {
	Type   string `json:"type"`
	Data   string `json:"data,omitempty"`
	Signal string `json:"signal,omitempty"`
}

type execServerMsg struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Code *int   `json:"code,omitempty"`
	Msg  string `json:"msg,omitempty"`
}

func (h *ExecHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !IsWebSocketRequest(r) {
		http.Error(w, "websocket required", http.StatusUpgradeRequired)
		return
	}

	conn, bufrw, err := wsUpgrade(w, r)
	if err != nil {
		return
	}
	defer conn.Close()

	var writeMu sync.Mutex
	send := func(msg execServerMsg) {
		data, _ := json.Marshal(msg)
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = wsWriteFrame(bufrw, wsOpText, data)
		_ = bufrw.Writer.Flush()
	}

	// Read spawn request (first frame)
	_, payload, err := wsReadFrame(bufrw.Reader)
	if err != nil {
		return
	}
	var req execSpawnReq
	if err := json.Unmarshal(payload, &req); err != nil {
		send(execServerMsg{Type: "error", Msg: "invalid spawn request"})
		return
	}

	// Security: only git
	if req.Cmd != "git" {
		send(execServerMsg{Type: "error", Msg: "only git commands are allowed"})
		return
	}

	// Security: cwd must be within OSH_HOME
	if req.Cwd != "" {
		home := config.HomeDir()
		if home != "/" {
			abs, err := filepath.Abs(req.Cwd)
			if err != nil || (!strings.HasPrefix(abs+"/", home+"/") && abs != home) {
				send(execServerMsg{Type: "error", Msg: "cwd is outside home directory"})
				return
			}
		}
	}

	safeDirArgs := []string{"-c", "safe.directory=*"}
	gitArgs := append(safeDirArgs, req.Args...)
	cmd := exec.Command("git", gitArgs...) //nolint:gosec
	if req.Cwd != "" {
		cmd.Dir = req.Cwd
	}

	stdinPipe, _ := cmd.StdinPipe()
	stdoutPipe, _ := cmd.StdoutPipe()
	stderrPipe, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		send(execServerMsg{Type: "error", Msg: err.Error()})
		return
	}

	var pipeDone sync.WaitGroup
	pipeDone.Add(2)

	go func() {
		defer pipeDone.Done()
		buf := make([]byte, 4096)
		for {
			n, err := stdoutPipe.Read(buf)
			if n > 0 {
				send(execServerMsg{Type: "stdout", Data: string(buf[:n])})
			}
			if err != nil {
				return
			}
		}
	}()

	go func() {
		defer pipeDone.Done()
		buf := make([]byte, 4096)
		for {
			n, err := stderrPipe.Read(buf)
			if n > 0 {
				send(execServerMsg{Type: "stderr", Data: string(buf[:n])})
			}
			if err != nil {
				return
			}
		}
	}()

	// Read stdin / kill from client in the background
	go func() {
		for {
			_, payload, err := wsReadFrame(bufrw.Reader)
			if err != nil {
				_ = cmd.Process.Kill()
				return
			}
			var msg execClientMsg
			if json.Unmarshal(payload, &msg) != nil {
				continue
			}
			switch msg.Type {
			case "stdin":
				_, _ = stdinPipe.Write([]byte(msg.Data))
			case "stdin-end":
				_ = stdinPipe.Close()
			case "kill":
				_ = cmd.Process.Kill()
			}
		}
	}()

	// Wait for both output pipes to drain, then report exit code
	pipeDone.Wait()

	exitCode := 0
	if err := cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}
	code := exitCode
	send(execServerMsg{Type: "close", Code: &code})
	// defer conn.Close() unblocks the reader goroutine
}
