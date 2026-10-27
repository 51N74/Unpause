import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiGoDir = path.resolve(__dirname, '../apps/api-go');

function resolveGoBinary() {
  if (process.env.GO_BIN && fs.existsSync(process.env.GO_BIN)) {
    return process.env.GO_BIN;
  }

  const probe = spawnSync('go', ['version'], { stdio: 'ignore' });
  if (probe.status === 0) {
    return 'go';
  }

  const candidates = [
    '/usr/local/go/bin/go',
    '/home/jptns/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.9.linux-amd64/bin/go',
    '/home/jptns/.gemini/antigravity/brain/29a3814e-7081-4cc2-ad46-d0876491d5d7/scratch/sdk/go/bin/go',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  console.error(
    'Error: Go toolchain not found in PATH or known SDK paths. Install Go >= 1.24 or set GO_BIN.'
  );
  process.exit(1);
}

const goBin = resolveGoBinary();
const args = process.argv.slice(2);

const proc = spawn(goBin, args, {
  cwd: apiGoDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${path.dirname(goBin)}${path.delimiter}${process.env.PATH || ''}`,
  },
});

proc.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
