#!/usr/bin/env node
// Production-like API for the load test (Implementation Plan step 31): N instances of the built
// API sharing one port, as PM2 cluster mode runs them on the VPS (Tech Stack: 4 instances).
// PM2's cluster mode is built on node:cluster, so this behaves the same without PM2 on the PC.
//   node scripts/load/cluster.mjs [--instances 4]      (from the repository root, after pnpm build)
import cluster from 'node:cluster';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const index = process.argv.indexOf('--instances');
const instances = Number(index > 0 ? process.argv[index + 1] : '4');
const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'api');

if (cluster.isPrimary) {
  process.chdir(apiDir);
  cluster.setupPrimary({ exec: path.join(apiDir, 'dist', 'main.js') });
  for (let i = 0; i < instances; i += 1) cluster.fork();
  cluster.on('exit', (worker, code) => {
    console.error(`API instance ${worker.process.pid} exited (${code}); stopping.`);
    process.exit(1);
  });
  console.log(`Started ${instances} API instances from ${apiDir}`);
}
