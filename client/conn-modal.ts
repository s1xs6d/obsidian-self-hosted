import type { ModalHandle } from "./lib/modal";
import { openObsidianModal } from "./lib/modal";
import { bus } from "./lib/service-bus";

const RETRY_SEC = 5;

interface ConnState {
  modal: ModalHandle | null;
  retryTimer: ReturnType<typeof setInterval> | null;
  retryCount: number;
  reconnectBtn: HTMLButtonElement | null;
  statusEl: HTMLElement | null;
}

// Persist state across HMR so an existing dialog isn't abandoned.
if (!window.__oshConnState) {
  window.__oshConnState = {
    modal: null, retryTimer: null, retryCount: 0,
    reconnectBtn: null as HTMLButtonElement | null,
    statusEl: null as HTMLElement | null,
  };
}
const _s = window.__oshConnState as unknown as ConnState;

function setReconnecting() {
  if (_s.retryTimer) { clearInterval(_s.retryTimer); _s.retryTimer = null; }
  if (_s.statusEl) _s.statusEl.textContent = "Connecting…";
  if (_s.reconnectBtn) { _s.reconnectBtn.textContent = "Connecting…"; _s.reconnectBtn.disabled = true; }
}

function resetCountdown() {
  _s.retryCount = RETRY_SEC;
  if (_s.statusEl) _s.statusEl.textContent = `Reconnecting in ${_s.retryCount} s…`;
  if (_s.reconnectBtn) { _s.reconnectBtn.textContent = "Reconnect"; _s.reconnectBtn.disabled = false; }
  if (!_s.retryTimer) _s.retryTimer = setInterval(tick, 1000);
}

function tick() {
  _s.retryCount--;
  if (_s.retryCount <= 0) {
    setReconnecting();
    bus.emit("conn:reconnect");
  } else if (_s.statusEl) {
    _s.statusEl.textContent = `Reconnecting in ${_s.retryCount} s…`;
  }
}

export function hideConnModal() {
  if (_s.retryTimer) { clearInterval(_s.retryTimer); _s.retryTimer = null; }
  if (_s.modal) { _s.modal.close(); _s.modal = null; }
  _s.reconnectBtn = null;
  _s.statusEl = null;
}

export function scheduleConnModal() {
  if (!_s.modal) {
    buildConnModal();
  } else {
    // Reconnect attempt failed while modal is already open — reset countdown.
    resetCountdown();
  }
}

function buildConnModal() {
  if (_s.modal) return;

  const contentEl = document.createElement("div");

  const desc = document.createElement("p");
  desc.textContent = "The connection to the server was lost.";
  contentEl.appendChild(desc);

  const status = document.createElement("p");
  status.style.cssText = "font-size:.85em;opacity:.7;margin-top:4px";
  contentEl.appendChild(status);
  _s.statusEl = status;

  // Build button directly so we keep a reference for loading-state updates.
  const btnRow = document.createElement("div");
  btnRow.className = "modal-button-container";
  const btn = document.createElement("button");
  btn.className = "mod-cta";
  btn.textContent = "Reconnect";
  btn.onclick = () => { setReconnecting(); bus.emit("conn:reconnect"); };
  btnRow.appendChild(btn);
  contentEl.appendChild(btnRow);
  _s.reconnectBtn = btn;

  _s.modal = openObsidianModal({
    title: "Connection Lost",
    closable: false,
    content: contentEl,
    onClose() {
      if (_s.retryTimer) { clearInterval(_s.retryTimer); _s.retryTimer = null; }
      _s.modal = null;
      _s.reconnectBtn = null;
      _s.statusEl = null;
    },
  });

  resetCountdown();
}

// Register bus listeners only once; stable forwarders so HMR updates take effect.
if (!window.__oshConnBound) {
  window.__oshConnBound = true;
  bus.on("ws:open",    () => window.__oshConnHide?.());
  bus.on("wsfs:open",  () => window.__oshConnHide?.());
  bus.on("ws:close",   () => window.__oshConnSchedule?.());
  bus.on("wsfs:close", () => window.__oshConnSchedule?.());
}
window.__oshConnHide     = hideConnModal;
window.__oshConnSchedule = scheduleConnModal;
