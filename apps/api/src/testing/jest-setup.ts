// Runs before every API test file (jest setupFiles). Each Jest worker process gets its own
// BullMQ prefix, so a queue worker started by one test file never takes jobs added by a test file
// running in parallel.
process.env.QUEUE_PREFIX = `bull-test-${process.env.JEST_WORKER_ID ?? '0'}`;
