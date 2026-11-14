// PM2 processes on the VPS (Tech Stack 9.6, Implementation Plan step 34): 4 API instances in
// cluster mode (zero-downtime `pm2 reload`) and one worker (queues, scheduler, one shared
// Chromium for PDFs). Paths go through /home/vk/current, the symlink to the live release, so a
// reload after switching it starts the new code. Secrets come from apps/api/.env, a link to
// /home/vk/shared/.env made by deploy/release.sh.
const CURRENT = '/home/vk/current';

module.exports = {
  apps: [
    {
      name: 'vk-api',
      cwd: `${CURRENT}/apps/api`,
      script: 'dist/main.js',
      node_args: '--enable-source-maps',
      instances: 4,
      exec_mode: 'cluster',
      max_memory_restart: '400M',
      // Give in-flight requests time to finish during a reload.
      kill_timeout: 10000,
      listen_timeout: 15000,
      env: { NODE_ENV: 'production', PROCESS_ROLE: 'api' },
    },
    {
      name: 'vk-worker',
      cwd: `${CURRENT}/apps/api`,
      script: 'dist/worker.js',
      node_args: '--enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1200M',
      // A job (an SMS, a PDF) may need a few seconds to finish before the worker stops.
      kill_timeout: 30000,
      env: { NODE_ENV: 'production', PROCESS_ROLE: 'worker' },
    },
  ],
};
