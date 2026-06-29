let platform;
if (typeof navigator !== "undefined") {
  const navPlatform = (navigator.platform || navigator.userAgentData?.platform || "").toLowerCase();
  if (navPlatform.includes("mac") || navPlatform.includes("darwin")) platform = "darwin";
  else if (navPlatform.includes("win")) platform = "win32";
  else platform = "linux";
} else {
  platform = "linux";
}

export { platform };

if (!globalThis.process) globalThis.process = {} as NonNullable<typeof globalThis.process>;
const proc = globalThis.process;

proc.platform = proc.platform || platform;
proc.type = "renderer";
proc.arch = proc.arch || "x64";
proc.pid = proc.pid || 1;
proc.ppid = proc.ppid || 0;
proc.execPath = proc.execPath || "/usr/bin/electron";
proc.argv = proc.argv || ["electron", "."];
proc.env = proc.env || {};
proc.env.NODE_ENV = proc.env.NODE_ENV || "production";

proc.versions = Object.assign(
  {
    electron: "28.2.3",
    node: "18.18.2",
    chrome: "120.0.6099.291",
    v8: "12.0.267.19-electron.0",
    uv: "1.46.0",
    zlib: "1.3",
    openssl: "3.0.12",
    modules: "120",
    napi: "9",
  },
  proc.versions || {},
);

proc.cwd = proc.cwd || (() => "/");
proc.chdir = proc.chdir || (() => {});
proc.exit = proc.exit || (() => globalThis.close());
proc.on = proc.on || (() => {});
proc.once = proc.once || (() => {});
proc.removeListener = proc.removeListener || (() => {});
proc.removeAllListeners = proc.removeAllListeners || (() => {});
proc.emit = proc.emit || (() => {});
proc.resourceUsage = proc.resourceUsage || (() => ({}));
proc.memoryUsage = proc.memoryUsage || (() => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }));

proc.nextTick = proc.nextTick || ((fn, ...args) => Promise.resolve().then(() => fn(...args)));

proc.hrtime =
  proc.hrtime ||
  ((prev) => {
    const now = performance.now() * 1e-3;
    const sec = Math.floor(now);
    const ns = Math.floor((now - sec) * 1e9);
    return prev ? [sec - prev[0], ns - prev[1]] : [sec, ns];
  });
(proc.hrtime as Record<string, unknown>).bigint = () => BigInt(Math.floor(performance.now() * 1e6));

export { proc };
