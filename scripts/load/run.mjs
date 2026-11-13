#!/usr/bin/env node
// Load test (Implementation Plan step 31, PRD NFR-01): every seeded voter signs in, confirms the
// identity, opens the ballot and submits it, on the NFR-01 schedule: a burst of 30 voters a
// second for the first 2 minutes, then the rest spread evenly over the remaining time. Then a
// staff account checks turnout, closes the event and times the results. Node built-ins only
// (global fetch), as Tech Stack 8.1 asks.
//
//   node apps/api/dist/cli/seed-load.js --voters 5000 --out load-seed.json
//   node scripts/load/run.mjs --seed load-seed.json [--api http://localhost:3000/api/v1]
//        [--minutes 30] [--burst-seconds 120] [--burst-rate 30] [--report load-report.json]
//
// Each simulated voter sends its own X-Forwarded-For address, as real phones would arrive
// through the reverse proxy; without it the per-IP sign-in limit would stop the test, not the
// system. Delete the seed file afterwards: it holds every voter's code.
import { readFile, writeFile } from 'node:fs/promises';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
}

const seedPath = option('seed');
if (!seedPath) {
  console.error(
    'Usage: node scripts/load/run.mjs --seed load-seed.json [--api URL] [--minutes 30]',
  );
  process.exit(2);
}
const API = option('api', 'http://localhost:3000/api/v1').replace(/\/+$/, '');
const MINUTES = Number(option('minutes', '30'));
const BURST_SECONDS = Number(option('burst-seconds', '120'));
const BURST_RATE = Number(option('burst-rate', '30'));
const REPORT = option('report', 'load-report.json');
const TIMEOUT_MS = 30_000;

const seed = JSON.parse(await readFile(seedPath, 'utf8'));
const voters = seed.voters;

/** A distinct private address per voter: 10.x.y.z. */
const addressOf = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

/** When voter i starts, in ms from the start: the burst first, then evenly spread. */
function startTime(i) {
  const inBurst = Math.min(voters.length, BURST_SECONDS * BURST_RATE);
  if (i < inBurst) return (i / BURST_RATE) * 1000;
  const rest = voters.length - inBurst;
  const restMs = Math.max(0, MINUTES * 60_000 - BURST_SECONDS * 1000);
  return BURST_SECONDS * 1000 + ((i - inBurst) / Math.max(1, rest)) * restMs;
}

const timings = { signIn: [], confirm: [], ballot: [], submit: [], total: [] };
const errors = new Map();
let failedBallots = 0;
let recordedBallots = 0;

function fail(step, detail) {
  const key = `${step}: ${detail}`;
  errors.set(key, (errors.get(key) ?? 0) + 1);
}

async function call(step, path, { method = 'GET', body, token, ip }) {
  const started = performance.now();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Forwarded-For': ip,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null);
  timings[step].push(performance.now() - started);
  if (!response.ok) throw new Error(`${response.status} ${json?.code ?? ''}`.trim());
  return json;
}

async function vote(i) {
  const voter = voters[i];
  const ip = addressOf(i + 1);
  const started = performance.now();
  let step = 'signIn';
  try {
    const signIn = await call(step, '/vote/sign-in', {
      method: 'POST',
      ip,
      body: { eventId: seed.eventId, membershipId: voter.membershipId, code: voter.code },
    });
    const token = signIn.token;
    step = 'confirm';
    await call(step, '/vote/confirm-identity', { method: 'POST', ip, token });
    step = 'ballot';
    const ballot = await call(step, '/vote/ballot', { ip, token });
    const selections = ballot.categories.map((category) => ({
      categoryId: category.id,
      choice: 'contester',
      contesterIds: category.contesters
        .slice(0, category.rules.exactCount ?? category.rules.minCount ?? 1)
        .map((c) => c.id),
    }));
    step = 'submit';
    const result = await call(step, '/vote/ballot', {
      method: 'POST',
      ip,
      token,
      body: { selections },
    });
    if (result.rejected.length > 0 || result.recorded.length !== selections.length) {
      failedBallots += 1;
      fail('submit', `rejected ${result.rejected.map((r) => r.reason).join(',')}`);
    } else {
      recordedBallots += 1;
    }
    timings.total.push(performance.now() - started);
  } catch (error) {
    failedBallots += 1;
    fail(step, error instanceof Error ? error.message : String(error));
  }
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const round = (ms) => (ms === null ? null : Math.round(ms));

/** Staff session for turnout, close and results (cookie + CSRF token). */
async function staffSession() {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.255.255.254' },
    body: JSON.stringify({ email: seed.staff.email, password: seed.staff.password }),
  });
  if (!response.ok) throw new Error(`staff sign-in failed: ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await response.json();
  return async (method, path) => {
    const started = performance.now();
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        'X-Forwarded-For': '10.255.255.254',
      },
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json?.code ?? ''}`);
    return { json, ms: performance.now() - started };
  };
}

console.log(
  `Load test: ${voters.length} voters over ${MINUTES} min (burst ${BURST_RATE}/s for ${BURST_SECONDS} s) against ${API}`,
);
const started = Date.now();
const progress = setInterval(() => {
  const done = recordedBallots + failedBallots;
  console.log(
    `  ${Math.round((Date.now() - started) / 1000)} s: ${done}/${voters.length} done, ${failedBallots} failed`,
  );
}, 30_000);
await Promise.all(
  voters.map(
    (_, i) => new Promise((resolve) => setTimeout(() => vote(i).then(resolve), startTime(i))),
  ),
);
clearInterval(progress);
const votingSeconds = (Date.now() - started) / 1000;

const staff = await staffSession();
const live = await staff('GET', `/events/${seed.eventId}/live`);
const close = await staff('POST', `/events/${seed.eventId}/close`);
const results = await staff('GET', `/events/${seed.eventId}/results`);
const snapshot = results.json?.snapshot;

const report = {
  api: API,
  voters: voters.length,
  minutes: MINUTES,
  votingSeconds: Math.round(votingSeconds),
  recordedBallots,
  failedBallots,
  errors: Object.fromEntries(errors),
  latencyMs: Object.fromEntries(
    Object.entries(timings).map(([step, values]) => [
      step,
      {
        count: values.length,
        p50: round(percentile(values, 50)),
        p95: round(percentile(values, 95)),
        p99: round(percentile(values, 99)),
        max: round(percentile(values, 100)),
      },
    ]),
  ),
  turnoutBeforeClose: live.json?.turnout?.voted ?? null,
  closeAndResultsMs: Math.round(close.ms),
  resultsVotersVoted: snapshot?.votersVoted ?? null,
};
const checks = {
  'p95 submit under 2 s': (report.latencyMs.submit.p95 ?? Infinity) < 2000,
  'zero failed ballots': failedBallots === 0,
  [`turnout equals ${voters.length}`]:
    report.turnoutBeforeClose === voters.length && report.resultsVotersVoted === voters.length,
  'results in under 60 s at close': report.closeAndResultsMs < 60_000,
};
report.checks = checks;
await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);

console.log('\nLatency (ms)        count    p50    p95    p99    max');
for (const [step, s] of Object.entries(report.latencyMs)) {
  console.log(
    `  ${step.padEnd(16)}${String(s.count).padStart(7)}${String(s.p50).padStart(7)}${String(s.p95).padStart(7)}${String(s.p99).padStart(7)}${String(s.max).padStart(7)}`,
  );
}
console.log(`\nBallots recorded ${recordedBallots}, failed ${failedBallots}`);
for (const [error, count] of errors) console.log(`  ${count} × ${error}`);
console.log(
  `Turnout before close ${report.turnoutBeforeClose}, in results ${report.resultsVotersVoted}`,
);
console.log(`Close with results: ${report.closeAndResultsMs} ms`);
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`Report: ${REPORT}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
