import { EventEmitter } from "./lib/event-emitter";

// Buffer.concat (from the bundled buffer package) concatenates chunks via
// Uint8Array.prototype.set — so chunks MUST be Uint8Arrays.
// But simple helpers call chunk.toString() expecting the decoded string, not
// the comma-separated decimal representation that plain Uint8Array gives.
// StringBuffer satisfies both: it IS a Uint8Array (bytes copy correctly) and
// overrides toString() to return the original string.
class StringBuffer extends Uint8Array {
  private readonly _str: string;
  constructor(str: string) {
    const bytes = new TextEncoder().encode(str);
    super(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this._str = str;
  }
  override toString(_encoding?: string): string {
    return this._str;
  }
}

interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdio?: unknown;
  [key: string]: unknown;
}

type StdinLike = { write: (data: string | Uint8Array) => void; end: () => void };
type StreamLike = EventEmitter & { resume: () => void };

class ChildProcess extends EventEmitter {
  stdout: StreamLike;
  stderr: StreamLike;
  stdin: StdinLike;
  pid: number;
  killed = false;
  private _ws: WebSocket | null = null;

  constructor(cmd: string, args: string[], opts: SpawnOptions) {
    super();
    this.pid = Math.floor(Math.random() * 65534) + 1;

    const makeStream = (): StreamLike => {
      const s = new EventEmitter() as StreamLike;
      s.resume = () => {};
      return s;
    };
    this.stdout = makeStream();
    this.stderr = makeStream();

    const stdinQueue: string[] = [];
    let wsReady = false;

    let ws: WebSocket;
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/exec/ws`);
    } catch (e) {
      this.stdin = { write: () => {}, end: () => {} };
      setTimeout(() => {
        this.emit("error", new Error("child_process: could not open WebSocket"));
        this.emit("close", 1, null);
      }, 0);
      return;
    }
    this._ws = ws;

    ws.addEventListener("open", () => {
      wsReady = true;
      ws.send(JSON.stringify({ cmd, args, cwd: opts?.cwd ?? "" }));
      for (const d of stdinQueue) ws.send(JSON.stringify({ type: "stdin", data: d }));
      stdinQueue.length = 0;
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let msg: { type: string; data?: string; code?: number; msg?: string };
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      switch (msg.type) {
        case "stdout":
          this.stdout.emit("data", new StringBuffer(msg.data ?? ""));
          break;
        case "stderr":
          this.stderr.emit("data", new StringBuffer(msg.data ?? ""));
          break;
        case "close": {
          const code = msg.code ?? 0;
          this.stdout.emit("end");
          this.stderr.emit("end");
          this.emit("exit", code, null);
          this.emit("close", code, null);
          ws.close();
          break;
        }
        case "error":
          this.emit("error", new Error(msg.msg ?? "exec error"));
          this.emit("close", 1, null);
          ws.close();
          break;
      }
    });

    ws.addEventListener("error", () => {
      this.emit("error", new Error("child_process: WebSocket error"));
      this.emit("close", 1, null);
    });

    this.stdin = {
      write: (data: string | Uint8Array) => {
        const str = typeof data === "string" ? data : new TextDecoder().decode(data);
        if (wsReady) {
          ws.send(JSON.stringify({ type: "stdin", data: str }));
        } else {
          stdinQueue.push(str);
        }
      },
      end: () => {
        if (wsReady) ws.send(JSON.stringify({ type: "stdin-end" }));
      },
    };
  }

  kill(signal?: string) {
    if (!this.killed && this._ws && this._ws.readyState === WebSocket.OPEN) {
      this.killed = true;
      this._ws.send(JSON.stringify({ type: "kill", signal: signal ?? "SIGTERM" }));
    }
  }
}

function collectOutput(proc: ChildProcess, cb: (err: Error | null, stdout: string, stderr: string) => void) {
  let out = "";
  let err = "";
  proc.stdout.on("data", (d) => { out += String(d); });
  proc.stderr.on("data", (d) => { err += String(d); });
  proc.on("close", (code) => {
    if (code === 0) {
      cb(null, out, err);
    } else {
      cb(Object.assign(new Error(err || `exit ${code}`), { code }) as Error, out, err);
    }
  });
  proc.on("error", (e) => cb(e as Error, "", ""));
}

export const childProcessShim = {
  spawn: (cmd: string, args?: string[], opts?: SpawnOptions): ChildProcess =>
    new ChildProcess(cmd, args ?? [], opts ?? {}),

  exec: (cmd: string, optsOrCb?: unknown, cb?: (err: Error | null, out: string, errOut: string) => void) => {
    let opts: SpawnOptions = {};
    let callback = cb;
    if (typeof optsOrCb === "function") {
      callback = optsOrCb as typeof cb;
    } else if (optsOrCb && typeof optsOrCb === "object") {
      opts = optsOrCb as SpawnOptions;
    }
    const parts = cmd.trim().split(/\s+/);
    const proc = new ChildProcess(parts[0], parts.slice(1), opts);
    if (callback) collectOutput(proc, callback);
    return proc;
  },

  execFile: (file: string, argsOrOpts?: unknown, optsOrCb?: unknown, cb?: (err: Error | null, out: string, errOut: string) => void) => {
    let args: string[] = [];
    let opts: SpawnOptions = {};
    let callback = cb;
    if (Array.isArray(argsOrOpts)) {
      args = argsOrOpts as string[];
      if (typeof optsOrCb === "function") callback = optsOrCb as typeof cb;
      else if (optsOrCb && typeof optsOrCb === "object") opts = optsOrCb as SpawnOptions;
    } else if (typeof argsOrOpts === "function") {
      callback = argsOrOpts as typeof cb;
    } else if (argsOrOpts && typeof argsOrOpts === "object") {
      opts = argsOrOpts as SpawnOptions;
      if (typeof optsOrCb === "function") callback = optsOrCb as typeof cb;
    }
    const proc = new ChildProcess(file, args, opts);
    if (callback) collectOutput(proc, callback);
    return proc;
  },

  spawnSync: () => ({
    pid: 0, output: [],
    stdout: new Uint8Array(0), stderr: new Uint8Array(0),
    status: 1, signal: null,
    error: new Error("spawnSync is not available in browser"),
  }),

  execSync: (_cmd: string): never => {
    throw new Error("execSync is not available in browser");
  },
};
