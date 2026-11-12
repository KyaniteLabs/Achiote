import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const readme = fs.readFileSync(path.resolve(__dirname, '..', 'plugins/achiote/README.md'), 'utf8');

describe('plugin README tells the truth about keys under Hermes (AC-2)', () => {
  it('says Hermes does not forward ambient environment variables to the server', () => {
    expect(readme).toMatch(/does not forward/i);
  });

  it('shows the config.yaml mcp_servers entry that passes ANTHROPIC_API_KEY to the server', () => {
    expect(readme).toMatch(/mcp_servers:\s*\n\s+achiote:/);
    expect(readme).toMatch(/env:\s*\n\s+ANTHROPIC_API_KEY:/);
  });
});
