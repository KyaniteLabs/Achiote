#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function run(command, args) {
  const printable = [command, ...args].join(' ');
  const result = spawnSync(command, args, { stdio: 'inherit', encoding: 'utf8' });
  if (result.error) throw new Error(`${printable} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${printable} exited with ${result.status}`);
}

const requiredSourceFiles = ['Dockerfile', 'tsconfig.json', 'src', 'package-lock.json'];
const missing = requiredSourceFiles.filter((file) => !fs.existsSync(file));
if (missing.length > 0) {
  console.error(`docker:smoke requires a source checkout. Missing: ${missing.join(', ')}`);
  process.exit(1);
}

const tag = `achiote-smoke:${Date.now()}`;
console.log(`Running docker build for ${tag}`);
run('docker', ['build', '-t', tag, '.']);
console.log('Docker image built. Run it with:');
console.log(`docker run --rm -p 3000:3000 -e ACHIOTE_AUTH_ENABLED=false ${tag}`);
