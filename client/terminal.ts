import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { BASE_URL, vaultQuery } from "./config";
import { injectCSS } from "./lib/dom";
import type { ModalHandle } from "./lib/modal";
import { openObsidianModal } from "./lib/modal";

const WS_BASE = BASE_URL.replace(/^http/, "ws");

// Modal sizing — overrides Obsidian's --dialog-* CSS variables (see how
// server/handler/auth.go's login page and file-browser.ts's .sfb-modal do
// the same) instead of a bare `maxWidth` on modalEl, which does nothing
// useful because .modal's actual width comes from `width: var(--dialog-width)`,
// not max-width.
//
// Obsidian's base .modal has no `height` — only `max-height` — so by default
// a modal sizes to fit its content (shrink-to-fit), with max-height only as
// an overflow cap. That leaves .xterm's `height:100%` resolving against an
// indefinite ancestor height, which the spec treats as `auto`: the terminal's
// own content then decides the container's height instead of the other way
// around, so the box (and the terminal size computed from it) visibly
// settles across a couple of layout/resize passes as xterm spins up. Giving
// the modal an explicit, definite `height` fixes that — flexbox has a real
// size to distribute on the very first layout, so fitAddon computes the
// final terminal size once, immediately.
const MODAL_CSS = [
  ".osh-term-modal{--dialog-width:900px;--dialog-max-width:94vw;--dialog-max-height:80vh;",
  "width:var(--dialog-width);height:min(700px,var(--dialog-max-height));",
  "max-height:var(--dialog-max-height);",
  "display:flex;flex-direction:column;overflow:hidden;transition:none!important;}",
  ".osh-term-modal .modal-content{flex:1;display:flex;flex-direction:column;",
  "padding:0!important;overflow:hidden;min-height:0;}",
  ".osh-term-container{flex:1;min-height:0;padding:8px;box-sizing:border-box;",
  "background:#000;overflow:hidden;border-radius:var(--radius-l);}",
  ".osh-term-container .xterm{height:100%;}",
].join("");

interface TermState {
  modal: ModalHandle | null;
  term: Terminal | null;
  fitAddon: FitAddon | null;
  ws: WebSocket | null;
  resizeObserver: ResizeObserver | null;
}

if (!window.__oshTermState) {
  window.__oshTermState = { modal: null, term: null, fitAddon: null, ws: null, resizeObserver: null };
}
const _s = window.__oshTermState as unknown as TermState;

function sendJSON(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connectTerminal(term: Terminal) {
  let ws: WebSocket;
  try {
    ws = new WebSocket(WS_BASE + "/exec/ws" + vaultQuery());
  } catch (e: unknown) {
    term.writeln("WebSocket error: " + (e as Error).message);
    return;
  }
  _s.ws = ws;

  ws.onopen = () => {
    sendJSON(ws, { cmd: "bash", args: [], pty: true, cols: term.cols, rows: term.rows });
  };

  // Forward every keystroke/paste from xterm to the pty. Without this the
  // terminal is read-only — it renders output but nothing typed goes anywhere.
  term.onData((data) => sendJSON(ws, { type: "stdin", data }));

  ws.onmessage = (e) => {
    let msg: { type: string; data?: string; code?: number; msg?: string };
    try {
      msg = JSON.parse(e.data);
    } catch (_) {
      return;
    }

    if (msg.type === "data" && msg.data) {
      term.write(msg.data);
      return;
    }
    if (msg.type === "close") {
      term.write(`\r\n\x1b[2m[process exited with code ${msg.code ?? 0}]\x1b[0m\r\n`);
      return;
    }
    if (msg.type === "error") {
      term.write(`\r\n\x1b[31m[error] ${msg.msg ?? "unknown error"}\x1b[0m\r\n`);
    }
  };

  ws.onclose = () => {
    if (_s.ws === ws) _s.ws = null;
  };
  ws.onerror = () => ws.close();
}

function buildTermModal() {
  injectCSS(xtermCss);
  injectCSS(MODAL_CSS);

  const container = document.createElement("div");
  container.className = "osh-term-container";

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "Menlo, Consolas, 'DejaVu Sans Mono', 'Courier New', monospace",
    fontSize: 14,
    scrollback: 5000,
    theme: { background: "#000000", foreground: "#f0f0f0", cursor: "#f0f0f0" },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  _s.term = term;
  _s.fitAddon = fitAddon;

  _s.modal = openObsidianModal({
    title: "Terminal",
    content: container,
    onOpen: (modal: { modalEl?: HTMLElement; contentEl?: HTMLElement; modal?: HTMLElement; content?: HTMLElement }) => {
      const modalRoot = modal.modalEl || modal.modal;
      if (modalRoot) modalRoot.classList.add("osh-term-modal");

      term.open(container);
      fitAddon.fit();
      connectTerminal(term);

      const ro = new ResizeObserver(() => {
        fitAddon.fit();
        if (_s.ws) sendJSON(_s.ws, { type: "resize", cols: term.cols, rows: term.rows });
      });
      ro.observe(container);
      _s.resizeObserver = ro;

      setTimeout(() => term.focus(), 150);
    },
    onClose: () => {
      if (_s.ws) {
        sendJSON(_s.ws, { type: "kill" });
        _s.ws.onclose = null;
        _s.ws.close();
        _s.ws = null;
      }
      _s.resizeObserver?.disconnect();
      _s.resizeObserver = null;
      _s.term?.dispose();
      _s.term = null;
      _s.fitAddon = null;
      _s.modal = null;
    },
  });
}

export function openTerminal() {
  if (_s.modal) {
    _s.modal.close();
    return;
  }
  buildTermModal();
}

export function isTerminalOpen(): boolean {
  return _s.modal !== null;
}
