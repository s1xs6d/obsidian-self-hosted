import { fsShim } from "./fs/index";
import { ipcRenderer } from "./ipc";
import { EventEmitter } from "./lib/event-emitter";
import { warn } from "./log";
import { osShim } from "./os";
import { pathShim } from "./path";
import { remote, safeStorage } from "./remote/index";

interface NativeImage {
  isEmpty: () => boolean;
  toPNG: () => Uint8Array;
  toJPEG: () => Uint8Array;
  toDataURL: () => string;
  resize: (opts?: { width?: number; height?: number }) => NativeImage;
  getSize: () => { width: number; height: number };
  setTemplateImage: (val: boolean) => void;
  isTemplateImage: () => boolean;
}

interface ElectronShim {
  ipcRenderer: typeof ipcRenderer;
  remote: typeof remote;
  shell: typeof remote.shell;
  clipboard: typeof remote.clipboard;
  nativeImage: {
    createEmpty: () => NativeImage;
    createFromPath: () => NativeImage;
    createFromDataURL: () => NativeImage;
    createFromBuffer: () => NativeImage;
    createFromNamedImage: () => NativeImage;
  };
  webFrame: {
    setZoomFactor: (f: number) => void;
    getZoomFactor: () => number;
    setZoomLevel: (level: number) => void;
    getZoomLevel: () => number;
    setVisualZoomLevelLimits: () => void;
    setLayoutZoomLevelLimits: () => void;
    insertCSS: (css: string) => number;
    removeInsertedCSS: (id?: number) => void;
    executeJavaScript: (code: string) => Promise<unknown>;
    setSpellCheckProvider: () => void;
    collectGarbage: () => void;
    findFrameByName: () => null;
    getFrameForSelector: () => null;
  };
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => void;
  };
  crashReporter: typeof remote.crashReporter;
  desktopCapturer: {
    getSources: (opts: Record<string, unknown>) => Promise<unknown[]>;
  };
  safeStorage: typeof safeStorage;
}

const _webFrameStyles = new Map<number, HTMLStyleElement>();
let _webFrameCssId = 0;

// Stable electronShim so Obsidian's captured `require('electron')` reference
// keeps pointing to the same object with updated implementations across HMR.
if (!window.__oshElectronShim) window.__oshElectronShim = {};
export const electronShim = window.__oshElectronShim as unknown as ElectronShim;
Object.assign(electronShim, {
  ipcRenderer,
  remote,
  shell: remote.shell,
  clipboard: remote.clipboard,
  nativeImage: {
    createEmpty: () => _emptyImage(),
    createFromPath: () => _emptyImage(),
    createFromDataURL: () => _emptyImage(),
    createFromBuffer: () => _emptyImage(),
    createFromNamedImage: () => _emptyImage(),
  },
  webFrame: {
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
      return Math.log(Number.parseFloat(document.body.style.zoom) || 1) / Math.log(1.2);
    },
    setVisualZoomLevelLimits() {},
    setLayoutZoomLevelLimits() {},
    insertCSS(css) {
      const s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
      const id = ++_webFrameCssId;
      _webFrameStyles.set(id, s);
      return id;
    },
    removeInsertedCSS(id?: number) {
      if (id == null) return;
      const el = _webFrameStyles.get(id);
      if (el) { el.remove(); _webFrameStyles.delete(id); }
    },
    executeJavaScript(code) {
      return Promise.resolve().then(() => new Function(code)());
    },
    setSpellCheckProvider() {},
    collectGarbage() {},
    findFrameByName() {
      return null;
    },
    getFrameForSelector() {
      return null;
    },
  },
  contextBridge: {
    exposeInMainWorld(key, value) {
      globalThis[key] = value;
    },
  },
  crashReporter: remote.crashReporter,
  desktopCapturer: {
    getSources: async (opts) => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const tracks = stream.getVideoTracks();
        if (tracks.length === 0) return [];
        const track = tracks[0];
        const settings = track.getSettings();
        const source = {
          name: track.label || "Screen",
          id: track.id || "screen:0:0",
          display_id: (settings as MediaTrackSettings & { displayId?: string }).displayId || "0",
          appIcon: null,
          thumbnail: null,
          _stream: stream,
          getStream: () => Promise.resolve(stream),
          toDataURL: () => "",
        };
        return [source];
      } catch (_) {
        return [];
      }
    },
  },
  safeStorage,
});

function _emptyImage(): NativeImage {
  return {
    isEmpty() {
      return true;
    },
    toPNG() {
      return new Uint8Array(0);
    },
    toJPEG() {
      return new Uint8Array(0);
    },
    toDataURL() {
      return "";
    },
    resize() {
      return this;
    },
    getSize() {
      return { width: 0, height: 0 };
    },
    setTemplateImage() {},
    isTemplateImage() {
      return false;
    },
  };
}

// require() polyfill — maps Node module names to shims
const _moduleCache: Record<string, unknown> = {};

globalThis.require = (moduleName: string): unknown => {
  if (_moduleCache[moduleName]) return _moduleCache[moduleName];
  let mod;
  switch (moduleName) {
    case "electron":
      mod = electronShim;
      break;
    case "path":
      mod = pathShim;
      break;
    case "fs":
    case "original-fs":
      mod = fsShim;
      break;
    case "os":
      mod = osShim;
      break;
    case "events":
      mod = EventEmitter;
      break;
    case "url":
      mod = {
        URL: globalThis.URL,
        URLSearchParams: globalThis.URLSearchParams,
        parse: (s) => {
          try {
            const u = new URL(s);
            return {
              href: u.href,
              protocol: u.protocol,
              host: u.host,
              pathname: u.pathname,
              search: u.search,
              hash: u.hash,
            };
          } catch (_) {
            return null;
          }
        },
        format: (o) => o?.href || String(o),
        resolve: (from, to) => new URL(to, from).href,
        pathToFileURL: (filepath) => {
          const abs = filepath ? filepath.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, "/$1") : "/";
          const encoded = abs
            .split("/")
            .map((s) => encodeURIComponent(s))
            .join("/");
          return new URL("file://" + (encoded.startsWith("/") ? "" : "/") + encoded);
        },
        fileURLToPath: (url) => {
          if (typeof url === "string") url = new URL(url);
          return url.pathname.replace(/(^\/[a-zA-Z]):\//, "$1:\\").replace(/\//g, "\\");
        },
      };
      break;
    case "querystring":
    case "qs":
      mod = {
        stringify: (obj) => new URLSearchParams(obj).toString(),
        parse: (str) => {
          const r = {};
          new URLSearchParams(str).forEach((v, k) => {
            r[k] = v;
          });
          return r;
        },
        escape: encodeURIComponent,
        unescape: decodeURIComponent,
      };
      break;
    case "crypto":
      mod = {
        randomBytes: (size) => {
          const a = new Uint8Array(size);
          crypto.getRandomValues(a);
          return a;
        },
        randomUUID: () => crypto.randomUUID(),
        createHash: (algo) => {
          warn("crypto.createHash(" + algo + ") is not synchronously available in browser; returning stub");
          return {
            update(d) {
              return this;
            },
            digest() {
              return "";
            },
          };
        },
        createHmac: () => ({
          update() {
            return this;
          },
          digest() {
            return "";
          },
        }),
        getRandomValues: (arr) => crypto.getRandomValues(arr),
        subtle: crypto.subtle,
      };
      break;
    case "buffer":
      mod = { Buffer: globalThis.Buffer };
      break;
    // btime sets file birth/creation time. Unsupported on Linux; no-op stub so
    // Obsidian's adapter.setFileTimes() doesn't throw when this.btime is truthy.
    case "btime":
      mod = { btime: () => {} };
      break;
    // get-fonts enumerates locally installed fonts for Obsidian's font picker.
    // Uses the Local Font Access API (Chrome 103+, requires HTTPS or localhost).
    // On plain HTTP+LAN the API is unavailable; Obsidian falls back to its own
    // built-in cross-platform font list automatically.
    case "get-fonts":
      mod = {
        async getFonts() {
          if (typeof window.queryLocalFonts !== "function") return [];
          try {
            const fonts = await window.queryLocalFonts();
            return [...new Set(fonts.map((f) => f.family))].sort();
          } catch (_) {
            // User denied permission, or API unavailable.
            return [];
          }
        },
      };
      break;
    case "stream": {
      // Minimal Node.js stream shim for plugins that import stream classes.
      // Uses EventEmitter as the base so .on()/.emit()/.pipe() work as expected.
      class Stream extends EventEmitter {
        pipe(dest) {
          this.on("data", (chunk) => dest.write(chunk));
          this.on("end", () => dest.end?.());
          return dest;
        }
      }
      class Readable extends Stream {
        constructor(opts?) {
          super();
          if (typeof opts?.read === "function") this._read = opts.read;
        }
        _read(_size?) {}
        push(chunk) {
          if (chunk === null) this.emit("end");
          else this.emit("data", chunk);
          return true;
        }
        resume() { return this; }
        pause() { return this; }
        destroy() { this.emit("close"); return this; }
        static from(iterable) {
          const r = new Readable();
          (async () => {
            try {
              for await (const chunk of iterable) r.push(chunk);
              r.push(null);
            } catch (e) { r.emit("error", e); }
          })();
          return r;
        }
      }
      class Writable extends Stream {
        constructor(opts?) {
          super();
          if (typeof opts?.write === "function") this._write = opts.write;
        }
        _write(chunk, _enc, cb) { cb(); }
        write(chunk, enc?, cb?) {
          if (typeof enc === "function") { cb = enc; enc = undefined; }
          this._write(chunk, enc as string, cb || (() => {}));
          return true;
        }
        end(chunk?, enc?, cb?) {
          if (chunk != null) this.write(chunk, enc as string);
          this.emit("finish");
          if (typeof cb === "function") cb();
          return this;
        }
        destroy() { this.emit("close"); return this; }
      }
      class Transform extends Writable {
        constructor(opts?) {
          super(opts);
          if (typeof opts?.transform === "function") this._transform = opts.transform;
          if (typeof opts?.flush === "function") this._flush = opts.flush;
        }
        _transform(chunk, _enc, cb) { this.push(chunk); cb(); }
        _flush(cb) { cb(); }
        push(chunk) {
          if (chunk !== null) this.emit("data", chunk);
          return true;
        }
      }
      class PassThrough extends Transform {}
      const pipeline = (...args) => {
        const cb = typeof args[args.length - 1] === "function" ? args.pop() : () => {};
        const streams = args;
        for (let i = 0; i < streams.length - 1; i++) streams[i].pipe(streams[i + 1]);
        streams[streams.length - 1].on("finish", () => cb(null));
        streams[0].on("error", cb);
        return streams[streams.length - 1];
      };
      mod = { Stream, Readable, Writable, Transform, PassThrough, pipeline };
      break;
    }
    case "assert": {
      const assert = (val, msg) => {
        if (!val) throw new Error(msg || "Assertion failed");
      };
      assert.ok = assert;
      assert.equal = (a, b, msg) => {
        if (a != b) throw new Error(msg || a + " != " + b);
      };
      assert.strictEqual = (a, b, msg) => {
        if (a !== b) throw new Error(msg || a + " !== " + b);
      };
      assert.deepEqual = (a, b, msg) => {
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || "Not deep equal");
      };
      assert.notEqual = (a, b, msg) => {
        if (a == b) throw new Error(msg || a + " == " + b);
      };
      assert.throws = (fn, err, msg) => {
        try {
          fn();
          throw new Error(msg || "Expected throw");
        } catch (e) {
          if (e === err) throw e;
        }
      };
      mod = assert;
      break;
    }
    default: {
      // Fall back to window globals for browser libs loaded via <script>
      const candidates = [
        moduleName,
        moduleName.replace(/[^a-zA-Z0-9]/g, ""),
        moduleName.replace(/-./g, (m) => m[1].toUpperCase()),
        moduleName.toUpperCase(),
      ];
      for (const name of candidates) {
        if (globalThis[name] !== undefined) {
          warn(`require('${moduleName}') resolved to window.${name}`);
          mod = globalThis[name];
          break;
        }
      }
      if (mod === undefined) {
        warn(`Module not found: ${moduleName} — returning empty object`);
        mod = {};
      }
    }
  }
  _moduleCache[moduleName] = mod;
  return mod;
};

(globalThis.require as unknown as { resolve: (name: string) => string }).resolve = (moduleName: string) => moduleName;
(globalThis.require as unknown as { cache: Record<string, unknown> }).cache = _moduleCache;
