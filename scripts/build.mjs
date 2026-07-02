import { build } from 'esbuild';
import { execSync } from 'child_process';
import { cpSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir   = join(__dirname, '..');
const staticDir = join(rootDir, 'static');
const serverDir = join(rootDir, 'server');
const distDir   = join(rootDir, 'dist');

const { version } = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));

console.log('==> osh build\n');

// 1. Build client shim
process.stdout.write('[1/3] Building client shim... ');
await build({
  entryPoints:   [join(rootDir, 'client', 'index.ts')],
  bundle:        true,
  format:        'iife',
  globalName:    '__oshShim',
  outfile:       join(staticDir, 'electron-shim.js'),
  target:        'es2020',
  platform:      'browser',
  minify:        true,
  legalComments: 'none',
  sourcemap:     false,
  logLevel:      'silent',
  define:        { __OSH_VERSION__: JSON.stringify(version) },
});
const shimRaw  = readFileSync(join(staticDir, 'electron-shim.js'));
const shimGzip = gzipSync(shimRaw);
console.log(`done (${(shimRaw.length / 1024).toFixed(1)} KB, ${(shimGzip.length / 1024).toFixed(1)} KB gzipped)`);

// 2. Build Go server binary
process.stdout.write('[2/3] Building Go server...   ');
rmSync(distDir, { recursive: true, force: true });
execSync('go build -o ../dist/osh-server -ldflags="-s -w" .', { cwd: serverDir, stdio: 'inherit' });
const binSize = readFileSync(join(distDir, 'osh-server')).length;
console.log(`done (${(binSize / 1024 / 1024).toFixed(1)} MB)`);

// 3. Copy static assets into dist/
process.stdout.write('[3/3] Copying static assets... ');
cpSync(staticDir, join(distDir, 'static'), { recursive: true });
console.log('done');

// Copy .env into dist/ with comments and blank lines stripped
const envSrc = join(rootDir, '.env');
if (existsSync(envSrc)) {
  const stripped = readFileSync(envSrc, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.trimStart().startsWith('#'))
    .join('\n') + '\n';
  writeFileSync(join(distDir, '.env'), stripped);
}

// Generate dist/run.sh
writeFileSync(join(distDir, 'run.sh'), `#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/.env" ]; then
  set -a
  . "$DIR/.env"
  set +a
fi
export GIN_MODE=release
exec "$DIR/osh-server" \\
  --obsidian-dir="$DIR/static" \\
  --static-dir="$DIR/static" \\
  --addr=":27123" \\
  "$@"
`);
chmodSync(join(distDir, 'run.sh'), 0o755);

console.log(`\n==> Done → dist/   (run with: dist/run.sh)`);
