// Runs before every API test file (jest setupFiles). Each Jest worker process gets its own
// BullMQ prefix, so a queue worker started by one test file never takes jobs added by a test file
// running in parallel.
import { tmpdir } from 'node:os';
import path from 'node:path';

const worker = process.env.JEST_WORKER_ID ?? '0';
process.env.QUEUE_PREFIX = `bull-test-${worker}`;
// Uploads go to a temporary directory per worker, never the development storage.
process.env.STORAGE_DIR = path.join(tmpdir(), `vk-test-storage-${worker}`);
