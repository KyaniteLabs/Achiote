#!/usr/bin/env node
// Usage: node scripts/load-test.mjs [concurrency=50] [total=1000] [port=3000]

const concurrency = parseInt(process.argv[2] || '50', 10);
const total = parseInt(process.argv[3] || '1000', 10);
const port = parseInt(process.argv[4] || '3000', 10);
const url = `http://127.0.0.1:${port}/health`;

const statusCodes = {};
let errors = 0;
let done = 0;
let sent = 0;

async function request() {
  try {
    const res = await fetch(url);
    statusCodes[res.status] = (statusCodes[res.status] || 0) + 1;
  } catch {
    errors++;
  } finally {
    done++;
  }
}

async function run() {
  console.log(`Load test: ${total} requests, ${concurrency} concurrent → ${url}\n`);
  const start = performance.now();

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (sent < total) {
        sent++;
        await request();
      }
    })());
  }
  await Promise.all(workers);

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  const rps = (total / parseFloat(elapsed)).toFixed(1);

  console.log(`Done in ${elapsed}s — ${rps} req/s`);
  console.log(`Errors: ${errors}`);
  console.log('Status codes:', statusCodes);
}

run();
