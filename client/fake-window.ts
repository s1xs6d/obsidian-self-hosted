import { getVaultId } from "./config";
import { debugLog, warn } from "./log";
import { wsSend } from "./websocket";

const _wcStyles = new Map<number, HTMLStyleElement>();
let _wcCssId = 0;

export const fakeWebContents = {
  id: 1,
  send(channel, ...args) {
    wsSend({ type: "send", channel, args, vault: getVaultId() });
  },
  getURL() {
    return globalThis.location.href;
  },
  openDevTools() {
    warn("openDevTools() not supported in browser");
  },
  closeDevTools() {},
  isDevToolsOpened() {
    return false;
  },
  setZoomFactor(f) {
    document.body.style.zoom = String(f);
  },
  getZoomFactor() {
    return Number.parseFloat(document.body.style.zoom) || 1;
  },
  setZoomLevel(level) {
    document.body.style.zoom = String(1.2 ** level);
  },
  getZoomLevel() {
    const z = Number.parseFloat(document.body.style.zoom) || 1;
    return Math.log(z) / Math.log(1.2);
  },
  insertCSS(css) {
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
    const id = ++_wcCssId;
    _wcStyles.set(id, s);
    return Promise.resolve(String(id));
  },
  removeInsertedCSS(key: string) {
    const id = Number(key);
    const el = _wcStyles.get(id);
    if (el) { el.remove(); _wcStyles.delete(id); }
    return Promise.resolve();
  },
  executeJavaScript(code) {
    return Promise.resolve().then(() => new Function(code)());
  },
  on() {},
  once() {},
  removeListener() {},
  session: {
    setSpellCheckerLanguages(langs) {
      debugLog("setSpellCheckerLanguages: " + langs.join(", "));
    },
    clearCache() {
      return Promise.resolve();
    },
    clearStorageData() {
      return Promise.resolve();
    },
    on() {},
    once() {},
    removeListener() {},
  },
};

export function makeWindow(doc: Document = document) {
  let _listeners = {};
  const zoomFactor = () => Number.parseFloat(doc.body.style.zoom) || 1;
  return {
    id: 1,
    setTitle(t) {
      doc.title = t;
    },
    getTitle() {
      return doc.title;
    },
    minimize() {
      warn("minimize() not supported in browser");
    },
    maximize() {
      doc.documentElement.requestFullscreen?.().catch(() => {});
    },
    unmaximize() {
      doc.exitFullscreen?.().catch(() => {});
    },
    restore() {},
    close() {
      globalThis.close();
    },
    destroy() {
      globalThis.close();
    },
    isMaximized() {
      return !!doc.fullscreenElement;
    },
    isMinimized() {
      return false;
    },
    isFocused() {
      return doc.hasFocus();
    },
    isDestroyed() {
      return false;
    },
    isFullScreen() {
      return !!doc.fullscreenElement;
    },
    setFullScreen(v) {
      v ? doc.documentElement.requestFullscreen?.().catch(() => {}) : doc.exitFullscreen?.().catch(() => {});
    },
    setFrameZoomLevel(level) {
      doc.body.style.zoom = String(1.2 ** level);
    },
    getFrameZoomLevel() {
      return Math.log(zoomFactor()) / Math.log(1.2);
    },
    isResizable() {
      return true;
    },
    setResizable() {},
    isMovable() {
      return true;
    },
    setMovable() {},
    isAlwaysOnTop() {
      return false;
    },
    setAlwaysOnTop() {},
    isVisible() {
      return true;
    },
    show() {},
    hide() {},
    focus() {},
    blur() {},
    getBounds() {
      const v = doc.defaultView || window;
      return { x: 0, y: 0, width: v.innerWidth, height: v.innerHeight };
    },
    setBounds(b, a) {
      debugLog("setBounds(" + JSON.stringify(b) + ", " + a + ")");
    },
    getContentBounds() {
      const v = doc.defaultView || window;
      return { x: 0, y: 0, width: v.innerWidth, height: v.innerHeight };
    },
    setContentBounds() {},
    getSize() {
      const v = doc.defaultView || window;
      return [v.innerWidth, v.innerHeight];
    },
    setSize() {},
    getContentSize() {
      const v = doc.defaultView || window;
      return [v.innerWidth, v.innerHeight];
    },
    setContentSize() {},
    getPosition() {
      return [0, 0];
    },
    setPosition() {},
    setMinimumSize() {},
    setMaximumSize() {},
    flashFrame() {},
    setSkipTaskbar() {},
    setMenu() {},
    setMenuBarVisibility() {},
    setAutoHideMenuBar() {},
    isMenuBarAutoHide() {
      return false;
    },
    setVibrancy() {},
    setWindowButtonVisibility() {},
    setProgressBar() {},
    setRepresentedFilename() {},
    setDocumentEdited() {},
    setBackgroundColor() {},
    setOpacity() {},
    getOpacity() {
      return 1;
    },
    capturePage() {
      return Promise.resolve(null);
    },
    webContents: fakeWebContents,
    on(event, cb) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(cb);
      const target = doc.defaultView || window;
      if (event === "focus") target.addEventListener("focus", cb);
      else if (event === "blur") target.addEventListener("blur", cb);
      else if (event === "resize") target.addEventListener("resize", cb);
      return this;
    },
    once(event, cb) {
      const wrapped = (...args) => {
        cb(...args);
        this.removeListener(event, wrapped);
      };
      return this.on(event, wrapped);
    },
    removeListener(event, cb) {
      if (_listeners[event]) _listeners[event] = _listeners[event].filter((l) => l !== cb);
      const target = doc.defaultView || window;
      if (event === "focus") target.removeEventListener("focus", cb);
      else if (event === "blur") target.removeEventListener("blur", cb);
      else if (event === "resize") target.removeEventListener("resize", cb);
      return this;
    },
    removeAllListeners(event) {
      if (event) _listeners[event] = [];
      else _listeners = {};
      return this;
    },
    emit(event, ...args) {
      (_listeners[event] || []).forEach((l) => {
        try {
          l(...args);
        } catch (e) {
          warn("window listener error: " + e.message);
        }
      });
      return this;
    },
  };
}

export const _currentWindow = makeWindow();
