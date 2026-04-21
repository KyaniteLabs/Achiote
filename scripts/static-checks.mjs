#!/usr/bin/env node
import fs from 'node:fs';

const checks = [
  {
    files: ['src/http-server.ts', 'README.md', 'SECURITY.md', 'docs/ARCHITECTURE.md'],
    forbidden: ['apiKey=', "searchParams.get('apiKey')", 'query param'],
  },
  {
    files: ['docs/landing/index.html', 'docs/landing/robots.txt', 'docs/landing/sitemap.xml'],
    forbidden: ['achiote.app'],
  },
];

let failures = 0;
for (const check of checks) {
  for (const file of check.files) {
    if (!fs.existsSync(file)) {
      failures++;
      console.error(`Required static-check input missing: ${file}`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of check.forbidden) {
      if (text.includes(pattern)) {
        failures++;
        console.error(`Forbidden pattern ${JSON.stringify(pattern)} found in ${file}`);
      }
    }
  }
}

if (!fs.existsSync('.gitignore') || !fs.readFileSync('.gitignore', 'utf8').includes('.claude/')) {
  failures++;
  console.error('Forbidden pattern guard missing: .claude/ must stay ignored');
}

if (failures > 0) process.exit(1);
console.log('Static checks passed');
