package ws

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/creack/pty"

	"osh/config"
)

// ExecHub handles WebSocket connections for remote process execution.
// When TerminalEnabled is true any command is permitted; otherwise only `git`
// commands are allowed.  cwd must always be within OSH_HOME.
type ExecHub struct {
	TerminalEnabled bool
}

// NewExecHub creates an ExecHub.
func NewExecHub(terminalEnabled bool) *ExecHub {
	return &ExecHub{TerminalEnabled: terminalEnabled}
}

type execSpawnReq struct {
	Cmd  string            `json:"cmd"`
	Args []string          `json:"args"`
	Cwd  string            `json:"cwd"`
	Env  map[string]string `json:"env"`
	// Pty requests a real pseudo-terminal instead of plain pipes. Only used by
	// the interactive terminal UI — child_process.spawn() (e.g. the Git
	// plugin) never sets this, since a pty would make git enable its pager
	// and ANSI colors by default and break output parsing.
	Pty  bool `json:"pty"`
	Cols int  `json:"cols"`
	Rows int  `json:"rows"`
}

type execClientMsg struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
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

	// Default to the current vault's directory (passed as ?vault=<id> on the
	// WS URL, same convention as /ws and /ws-fs) when the caller didn't
	// specify an explicit cwd — e.g. the terminal UI opening into the vault
	// the user is currently looking at instead of wherever the server process
	// happens to run from.
	if req.Cwd == "" {
		if vaultID := r.URL.Query().Get("vault"); vaultID != "" {
			if vaultPath, ok := config.VaultByID(vaultID); ok {
				req.Cwd = vaultPath
			}
		}
	}

	// Security: when terminal is disabled, only non-interactive git commands
	// are allowed — never a pty.
	if !h.TerminalEnabled && (req.Cmd != "git" || req.Pty) {
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

	// git's "dubious ownership" check (bind-mounted vault dir owned by a
	// different uid than the container's root) is handled once, globally, in
	// the Dockerfile via `git config --global --add safe.directory '*'` —
	// not here, so this doesn't have to be duplicated across every git
	// invocation path. Local/bare-metal runs are on their own for this.
	var cmd *exec.Cmd
	if h.TerminalEnabled && req.Cmd != "git" {
		cmd = exec.Command(req.Cmd, req.Args...) //nolint:gosec
	} else {
		cmd = exec.Command("git", req.Args...) //nolint:gosec
	}
	if req.Cwd != "" {
		cmd.Dir = req.Cwd
	}

	if req.Pty {
		runPty(cmd, req, bufrw, send)
		return
	}
	runPipe(cmd, bufrw, send)
}

// runPty attaches a real pseudo-terminal to cmd so interactive programs
// (readline, ANSI colors/cursor control, job-control signals like Ctrl+C)
// behave as they would in a real terminal. Used by the interactive terminal UI.
func runPty(cmd *exec.Cmd, req execSpawnReq, bufrw *bufio.ReadWriter, send func(execServerMsg)) {
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	cols, rows := req.Cols, req.Rows
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		send(execServerMsg{Type: "error", Msg: err.Error()})
		return
	}

	var closeOnce sync.Once
	closePty := func() { closeOnce.Do(func() { _ = ptmx.Close() }) }
	defer closePty()

	// pty -> websocket. On Linux, once the child exits and the slave side has
	// no more open fds, Read returns EIO rather than io.EOF — any read error
	// is treated as "the session is over".
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				send(execServerMsg{Type: "data", Data: string(buf[:n])})
			}
			if err != nil {
				return
			}
		}
	}()

	// websocket -> pty / control messages (stdin bytes, resize, kill)
	go func() {
		for {
			_, payload, err := wsReadFrame(bufrw.Reader)
			if err != nil {
				_ = cmd.Process.Kill()
				closePty()
				return
			}
			var msg execClientMsg
			if json.Unmarshal(payload, &msg) != nil {
				continue
			}
			switch msg.Type {
			case "stdin":
				_, _ = ptmx.Write([]byte(msg.Data))
			case "resize":
				if msg.Cols > 0 && msg.Rows > 0 {
					_ = pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(msg.Cols), Rows: uint16(msg.Rows)})
				}
			case "kill":
				_ = cmd.Process.Kill()
			}
		}
	}()

	<-readerDone

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
	// defer conn.Close() (in ServeHTTP) unblocks the client-reader goroutine
}

// runPipe runs cmd with plain stdout/stderr pipes and no pty — used for
// non-interactive process execution (e.g. the Git plugin via
// child_process.spawn), where a pty would change git's default behavior
// (pager, color) and break output parsing.
func runPipe(cmd *exec.Cmd, bufrw *bufio.ReadWriter, send func(execServerMsg)) {
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
