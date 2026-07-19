import { context } from 'esbuild';
import { spawn } from 'child_process';
import { watch, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const { version } = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const DEV_TRIGGER = 'http://localhost:27123/dev/reload-trigger';
const DEV_PING    = 'http://localhost:27123/dev/ping';

// Load .env file from project root into process.env
const envPath = join(rootDir, '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

let goProc      = null;
let goRestart   = false; // true while Go is in the middle of restarting
let shimReady   = false; // true after initial shim build completes

// ---- esbuild context --------------------------------------------------------

const ctx = await context({
  entryPoints: [join(rootDir, 'client', 'index.ts')],
  bundle:      true,
  format:      'iife',
  globalName:  '__oshShim',
  outfile:     join(rootDir, 'static', 'electron-shim.js'),
  target:      'es2020',
  platform:    'browser',
  minify:      false,
  legalComments: 'none',
  sourcemap:   false,
  logLevel:    'info',
  define:      { __OSH_VERSION__: JSON.stringify(version) },
  loader:      { '.css': 'text' },
  plugins: [{
    name: 'dev-reload',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length > 0) return;
        if (!shimReady) return; // handled explicitly below
        if (!goRestart) {
          // Subsequent shim build: wait a tick for the file to flush, then reload
          setImmediate(() => {
            fetch(DEV_TRIGGER, { method: 'POST' }).catch(() => {});
          });
        }
      });
    },
  }],
});

// Initial build (blocks until done)
process.stdout.write('[osh] Building shim...');
await ctx.rebuild();
shimReady = true;
console.log(' done');

// Start Go server only after initial shim is ready
startGoServer();

// Watch client/ for changes — esbuild rebuilds automatically
await ctx.watch();
console.log('[osh] Watching client/ for shim changes');

// ---- Go server management ---------------------------------------------------

function startGoServer() {
  const proc = spawn(
    'go', ['run', '.', '--static-dir=../static', '--obsidian-dir=../static', '--addr=:27123'],
    {
      cwd: join(rootDir, 'server'),
      stdio: 'inherit',
      env: { ...process.env, GIN_MODE: 'debug' },
      // `go run` forks the actual compiled binary as a child of this process;
      // SIGTERM sent to just this PID only reaches the `go run` wrapper; the
      // relay to its child is not reliable, so the compiled binary can survive
      // and keep the port. `detached: true` puts both in their own process
      // group so killGoServer() below can signal the whole group at once.
      detached: true,
    },
  );
  proc.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
    if (code !== 0) {
      console.error(`[osh] Go server exited (code=${code}), retrying in 1s...`);
      setTimeout(startGoServer, 1000);
    }
  });
  goProc = proc;
}

// Signals the whole process group (`go run` wrapper + the compiled binary it
// forked), not just the wrapper — see the `detached` comment in startGoServer.
function killGoServer(signal) {
  if (!goProc) return;
  try {
    process.kill(-goProc.pid, signal);
  } catch (_) {
    // Group already gone.
  }
}

function restartGoServer() {
  if (goRestart) return;
  goRestart = true;
  console.log('[osh] Server source changed → restarting Go server');
  if (goProc) {
    killGoServer('SIGTERM');
    goProc = null;
  }
  // Give the process a moment to exit before spawning a new one.
  // The browser will poll /dev/ping after the SSE drops and reload automatically.
  setTimeout(() => {
    goRestart = false;
    startGoServer();
  }, 300);
}

// ---- Watch server/ for Go file changes --------------------------------------

watch(join(rootDir, 'server'), { recursive: true }, debounce((_, filename) => {
  if (!filename) return;
  if (!/\.(go|mod|sum)$/.test(filename)) return;
  restartGoServer();
}, 400));

console.log('[osh] Watching server/ for Go changes');

// ---- Graceful shutdown ------------------------------------------------------

process.on('SIGINT', () => {
  console.log('\n[osh] Shutting down...');
  ctx.dispose();
  killGoServer('SIGTERM');
  process.exit(0);
});

// ---- Utility ----------------------------------------------------------------

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
