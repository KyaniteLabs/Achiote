import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
const dockerSmoke = fs.readFileSync('scripts/docker-smoke.mjs', 'utf8');

describe('Docker runtime hardening', () => {
  it('runs the production image as non-root with an HTTP healthcheck', () => {
    expect(dockerfile).toMatch(/\nUSER\s+node\b/);
    expect(dockerfile).toMatch(/\nHEALTHCHECK\b/);
    expect(dockerfile).toContain("process.env.PORT||'3000'");
  });

  it('does not copy source data into the runtime image when dist data is built', () => {
    expect(dockerfile).not.toMatch(/COPY\s+--from=builder\s+\/app\/src\/data\s+\.\/src\/data/);
  });

  it('smoke test runs the container and verifies health plus readiness', () => {
    expect(dockerSmoke).toContain("capture('docker', [\n    'run'");
    expect(dockerSmoke).toContain("capture('docker', ['inspect'");
    expect(dockerSmoke).toContain("/ready");
    expect(dockerSmoke).toContain("Health.Status");
  });
});
