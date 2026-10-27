import { spawn } from 'node:child_process';

const children = [];

function startProcess(name, args) {
  const proc = spawn('npm', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.push(proc);
  proc.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
  return proc;
}

console.log('Starting Unpause API and Web development servers...');
startProcess('api', ['run', 'dev:api']);
startProcess('web', ['run', 'dev:web']);

function shutdown() {
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
