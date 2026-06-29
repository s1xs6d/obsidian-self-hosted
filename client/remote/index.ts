import { clipboardWrite } from "../clipboard";
import { _currentWindow, fakeWebContents, makeWindow } from "../fake-window";
import { debugLog, warn } from "../log";
import { app } from "./app";
import { dialog } from "./dialog";
import { Menu, MenuItem, buildFromTemplate } from "./menu";
import { safeStorage } from "./safe-storage";
import { screen } from "./screen";
import { shell } from "./shell";

export { safeStorage, Menu, MenuItem, buildFromTemplate, dialog, shell, app, screen };

const nativeTheme = (() => {
  const _nt = {
    get shouldUseDarkColors() {
      return !!globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches;
    },
    get themeSource() {
      return "system";
    },
    set themeSource(v) {
      debugLog("nativeTheme.themeSource = " + v);
    },
    shouldUseHighContrastColors: false,
    shouldUseInvertedColorScheme: false,
    on() {
      return _nt;
    },
    once() {
      return _nt;
    },
    removeListener() {
      return _nt;
    },
    removeAllListeners() {
      return _nt;
    },
    emit() {
      return false;
    },
    off() {
      return _nt;
    },
    addListener() {
      return _nt;
    },
  };
  return _nt;
})();

export const remote = {
  dialog,
  shell,
  app,
  Menu: Object.assign(Menu, { buildFromTemplate }),
  MenuItem,
  BrowserWindow: () => makeWindow(),
  getCurrentWindow: () => _currentWindow,
  getCurrentWebContents: () => fakeWebContents,
  getFocusedWindow: () => _currentWindow,
  systemPreferences: {
    _defaults: {
      AppleActionOnDoubleClick: "Maximize",
      AppleInterfaceStyle: "",
      AppleShowScrollBars: "WhenScrolling",
      NSAutomaticCapitalizationEnabled: true,
      NSAutomaticDashSubstitutionEnabled: true,
      NSAutomaticPeriodSubstitutionEnabled: true,
      NSAutomaticQuoteSubstitutionEnabled: true,
      NSAutomaticSpellingCorrectionEnabled: true,
    },
    getUserDefault(key) {
      const v = this._defaults[key];
      if (v === undefined) {
        debugLog(`systemPreferences.getUserDefault(${key}) \u2192 undefined`);
        return null;
      }
      return v;
    },
    setUserDefault(key, type, value) {
      this._defaults[key] = value;
    },
    subscribeNotification(name) {
      debugLog(`subscribeNotification(${name})`);
      return 0;
    },
    unsubscribeNotification() {},
    subscribeLocalNotification() {
      return 0;
    },
    unsubscribeLocalNotification() {},
    isAeroGlassEnabled() {
      return false;
    },
    getAccentColor() {
      return "ffffffff";
    },
    getColor() {
      return "#000000";
    },
    getMediaAccessStatus() {
      return "granted";
    },
    getAnimationSettings() {
      return { shouldRenderRichAnimation: true, scrollAnimationsEnabledBySystem: true };
    },
    isDarkMode() {
      return !!globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches;
    },
    isHighContrastColorScheme() {
      return false;
    },
    isInvertedColorScheme() {
      return false;
    },
    on() {},
    removeListener() {},
  },
  powerMonitor: {
    on() {},
    once() {},
    removeListener() {},
    removeAllListeners() {},
    getSystemIdleState() {
      return "active";
    },
    getSystemIdleTime() {
      return 0;
    },
  },
  screen,
  nativeTheme,
  clipboard: {
    readText() {
      return "";
    },
    writeText(text) {
      clipboardWrite(text).catch((e) => warn("clipboard.writeText failed: " + e.message));
    },
    readHTML() {
      return "";
    },
    writeHTML() {},
    readImage() {
      return null;
    },
    writeImage() {},
    readBookmark() {
      return { title: "", url: "" };
    },
    writeBookmark() {},
    readBuffer() {
      return null;
    },
    writeBuffer() {},
    availableFormats() {
      return ["text/plain"];
    },
    has(format) {
      return format === "text/plain";
    },
    clear() {},
  },
  globalShortcut: (() => {
    const _shortcuts = {};
    const _modMap = {
      Command: "Meta",
      Cmd: "Meta",
      Control: "Control",
      Ctrl: "Control",
      Alt: "Alt",
      Option: "Alt",
      Shift: "Shift",
      Super: "Meta",
    };
    const _keyMap = {
      Plus: "+",
      Minus: "-",
      Space: " ",
      Left: "ArrowLeft",
      Right: "ArrowRight",
      Up: "ArrowUp",
      Down: "ArrowDown",
      Return: "Enter",
      Esc: "Escape",
      Escape: "Escape",
      Tab: "Tab",
      Backspace: "Backspace",
      Delete: "Delete",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
    };

    function _parseAccelerator(acc) {
      const parts = acc.split("+");
      const mods = {};
      let key = null;
      for (const p of parts) {
        const mappedKey = _modMap[p];
        if (mappedKey) {
          mods[mappedKey] = true;
        } else {
          key = _keyMap[p] || p;
        }
      }
      return { mods: mods, key: key };
    }

    function _handleKeyDown(e) {
      for (const acc of Object.keys(_shortcuts)) {
        const parsed = _shortcuts[acc].parsed;
        if (!parsed || !parsed.key) continue;
        const pressedKey = e.key;
        if (pressedKey.toLowerCase() !== parsed.key.toLowerCase()) continue;
        const modChecks = {
          Meta: e.metaKey,
          Control: e.ctrlKey,
          Alt: e.altKey,
          Shift: e.shiftKey,
        };
        let match = true;
        for (const mod of Object.keys(modChecks)) {
          if (parsed.mods[mod] && !modChecks[mod]) {
            match = false;
            break;
          }
          if (!parsed.mods[mod] && modChecks[mod] && Object.keys(parsed.mods).length > 0) {
            match = false;
            break;
          }
        }
        if (match) {
          e.preventDefault();
          e.stopPropagation();
          _shortcuts[acc].callback();
          return;
        }
      }
    }

    let _listenerAttached = false;
    function _ensureListener() {
      if (_listenerAttached) return;
      _listenerAttached = true;
      document.addEventListener("keydown", _handleKeyDown, true);
    }

    return {
      register(accelerator, callback) {
        debugLog("globalShortcut.register: " + accelerator);
        const parsed = _parseAccelerator(accelerator);
        if (!parsed.key) {
          warn("globalShortcut: could not parse " + accelerator);
          return false;
        }
        _shortcuts[accelerator] = { parsed, callback };
        _ensureListener();
        return true;
      },
      registerAll(shortcuts) {
        debugLog("globalShortcut.registerAll");
        if (Array.isArray(shortcuts)) {
          shortcuts.forEach(([acc, cb]) => this.register(acc, cb));
        }
      },
      unregister(accelerator) {
        delete _shortcuts[accelerator];
      },
      unregisterAll() {
        Object.keys(_shortcuts).forEach((k) => delete _shortcuts[k]);
      },
      isRegistered(accelerator) {
        return !!_shortcuts[accelerator];
      },
    };
  })(),
  net: {
    request(options) {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      let aborted = false;
      let _method = "GET";
      let _url = "";
      let _headers = {};
      let _body = null;
      let _reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      if (typeof options === "string") {
        _url = options;
      } else if (options) {
        _url = options.url || options.href || "";
        _method = (options.method || "GET").toUpperCase();
        _headers = options.headers || {};
        if (options.body) _body = options.body;
      }

      const req = {
        on(event, cb) {
          (listeners[event] = listeners[event] || []).push(cb);
          return req;
        },
        once(event, cb) {
          const wrapper = (...args) => {
            cb(...args);
            req.removeListener(event, wrapper);
          };
          (listeners[event] = listeners[event] || []).push(wrapper);
          return req;
        },
        removeListener(event, cb) {
          if (listeners[event]) listeners[event] = listeners[event].filter((l) => l !== cb);
          return req;
        },
        setHeader(name, value) {
          _headers[name] = value;
          return req;
        },
        getHeader(name) {
          return _headers[name] || null;
        },
        removeHeader(name) {
          delete _headers[name];
          return req;
        },
        write(chunk) {
          _body = _body || "";
          _body += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
          return req;
        },
        end(chunk) {
          if (chunk) req.write(chunk);
          if (aborted) return;
          (async () => {
            try {
              const fetchOpts: { method: string; headers: Record<string, string>; body?: string | null } = { method: _method, headers: { ..._headers } };
              if (_method !== "GET" && _method !== "HEAD") fetchOpts.body = _body;
              const response = await globalThis.fetch(_url, fetchOpts);
              const res = {
                statusCode: response.status,
                statusMessage: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                on(event, cb) {
                  (listeners["response-" + event] = listeners["response-" + event] || []).push(cb);
                  return res;
                },
              };
              (listeners.response || []).forEach((cb) => cb(res));
              _reader = response.body.getReader();
              const reader = _reader;
              const pump = async () => {
                while (!aborted) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  (listeners["response-data"] || []).forEach((cb) => cb(value));
                }
                if (!aborted) (listeners["response-end"] || []).forEach((cb) => cb());
                _reader = null;
              };
              pump().catch((err) => (listeners.error || []).forEach((cb) => cb(err)));
            } catch (err) {
              (listeners.error || []).forEach((cb) => cb(err));
            }
          })();
          return req;
        },
        abort() {
          aborted = true;
          if (_reader) { _reader.cancel().catch(() => {}); _reader = null; }
          (listeners.abort || []).forEach((cb) => cb());
          return req;
        },
      };
      return req;
    },
    fetch: (url, opts) => globalThis.fetch(url, opts),
  },
  crashReporter: { start() {}, addExtraParameter() {}, removeExtraParameter() {} },
  Tray: () => {
    debugLog("Tray created (no-op in browser)");
    return {
      setImage() {},
      setToolTip() {},
      setTitle() {},
      setContextMenu() {},
      on() {},
      removeListener() {},
      destroy() {},
    };
  },
  Notification: (() => {
    class ElectronNotification {
      private _opts: { title?: string; body?: string; icon?: string };
      private _listeners: Record<string, ((...args: unknown[]) => void)[]>;

      constructor(opts?: { title?: string; body?: string; icon?: string }) {
        this._opts = opts || {};
        this._listeners = {};
      }
      show() {
        if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
          const n = new Notification(this._opts.title || "Obsidian", {
            body: this._opts.body || "",
            icon: this._opts.icon,
          });
          n.onclick = () => (this._listeners.click || []).forEach((cb) => cb());
          n.onclose = () => (this._listeners.close || []).forEach((cb) => cb());
        }
        return this;
      }
      on(event, cb) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(cb);
        return this;
      }
      close() {}
      static isSupported() {
        return typeof Notification !== "undefined";
      }
    }
    return ElectronNotification;
  })(),
  safeStorage,
};
