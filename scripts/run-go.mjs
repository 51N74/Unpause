import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiGoDir = path.resolve(__dirname, '../apps/api-go');

function resolveGoBinary() {
  const configuredGoBin = process.env.GO_BIN;
  if (configuredGoBin !== undefined && configuredGoBin.trim() !== '') {
    const rawCandidate = configuredGoBin.trim();
    const candidate =
      path.isAbsolute(rawCandidate) ||
      rawCandidate.includes(path.sep) ||
      rawCandidate.includes('/')
        ? path.resolve(rawCandidate)
        : rawCandidate;

    const probe = spawnSync(candidate, ['version'], {
      stdio: 'ignore',
      shell: false,
    });
    if (probe.error || probe.status !== 0) {
      const detail = probe.error
        ? ` (${probe.error.message})`
        : ` (exit code ${probe.status ?? 'unknown'})`;
      console.error(
        `Error: Configured GO_BIN "${rawCandidate}" is not a valid Go executable${detail}.`
      );
      process.exit(1);
    }
    return candidate;
  }

  const probe = spawnSync('go', ['version'], {
    stdio: 'ignore',
    shell: false,
  });
  if (!probe.error && probe.status === 0) {
    return 'go';
  }

  console.error(
    'Error: Go toolchain ("go") was not found in PATH. Install Go >= 1.24 and ensure it is on PATH, or set GO_BIN to the Go executable path.'
  );
  process.exit(1);
}

const goBin = resolveGoBinary();
const args = process.argv.slice(2);

const env = { ...process.env };
if (path.isAbsolute(goBin)) {
  const binDir = path.dirname(goBin);
  env.PATH = env.PATH ? `${binDir}${path.delimiter}${env.PATH}` : binDir;
}

const proc = spawn(goBin, args, {
  cwd: apiGoDir,
  stdio: 'inherit',
  shell: false,
  env,
});

proc.on('error', (err) => {
  console.error(`Error: Failed to launch Go process ("${goBin}"): ${err.message}`);
  process.exit(1);
});

proc.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
