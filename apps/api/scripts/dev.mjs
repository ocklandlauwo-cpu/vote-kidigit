// Development runner: builds the shared package once, then runs one `nest build --watch`
// and restarts both entry points (API and worker) with `node --watch` when dist changes.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const children = [];

function run(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: apiDir,
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, ...env },
  });
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) child.kill();
  process.exit(0);
}

const shared = spawnSync('pnpm', ['--filter', '@vote-kidigit/shared', 'build'], {
  cwd: apiDir,
  stdio: 'inherit',
  shell: isWindows,
});
if (shared.status !== 0) process.exit(shared.status ?? 1);

const generate = spawnSync('pnpm', ['exec', 'prisma', 'generate'], {
  cwd: apiDir,
  stdio: 'inherit',
  shell: isWindows,
});
if (generate.status !== 0) process.exit(generate.status ?? 1);

// Start from an empty dist so the entry points launch only after the first fresh build;
// a stale dist from `pnpm build` would start them before the watcher deletes and rebuilds it.
rmSync(join(apiDir, 'dist'), { recursive: true, force: true });
run('pnpm', ['exec', 'nest', 'build', '--watch', '--preserveWatchOutput']);

const entries = [
  ['dist/main.js', 'api'],
  ['dist/worker.js', 'worker'],
];
const waitForBuild = setInterval(() => {
  if (!entries.every(([file]) => existsSync(join(apiDir, file)))) return;
  clearInterval(waitForBuild);
  for (const [file, role] of entries) {
    run(process.execPath, ['--enable-source-maps', '--watch', file], { PROCESS_ROLE: role });
  }
}, 500);

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
