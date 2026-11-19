import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

/**
 * The OpenAPI documents in docs/ are the machine-readable contract for the
 * HTTP surface. This suite pins them to the routes the server actually
 * implements, parsed straight out of the server source, so that a route added
 * without spec coverage (or a spec path with no implementation) fails
 * `npm run check`. It also pins the load-bearing contract details that
 * integrators depend on: the /mcp initialize-first requirement, the /v1/ask
 * SSE event vocabulary with `guarded` on `done`, and the admin-gated 404 on
 * GET /events.
 */

const SERVER_SOURCE = 'src/http-server.ts';
const COMPILED_SERVER = 'dist/http-server.js';

/**
 * Spec paths that are deliberately documented without a `pathname ===` match
 * in the server source. Add entries only with a stated reason.
 */
const SPEC_ONLY_ALLOWLIST: readonly string[] = [];

function implementedPaths(source: string): string[] {
  return [...source.matchAll(/pathname === '([^']+)'/g)].map((match) => match[1]);
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

type Operation = { description?: string };
type PathItem = { get?: Operation; post?: Operation };
type Spec = {
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, { description?: string }> };
};

describe('openapi route coverage', () => {
  const serverSource = fs.readFileSync(SERVER_SOURCE, 'utf8');
  const implemented = unique(implementedPaths(serverSource));
  const spec = JSON.parse(fs.readFileSync('docs/openapi.json', 'utf8')) as Spec;
  const specPaths = unique(Object.keys(spec.paths ?? {}));

  it('implements a non-trivial route table', () => {
    expect(implemented.length).toBeGreaterThanOrEqual(14);
  });

  it('documents every implemented route in docs/openapi.json', () => {
    const missing = implemented.filter((path) => !(path in (spec.paths ?? {})));
    expect(
      missing,
      'routes implemented in the server but missing from docs/openapi.json',
    ).toEqual([]);
  });

  it('documents no route that the server does not implement', () => {
    const extra = specPaths.filter(
      (path) => !implemented.includes(path) && !SPEC_ONLY_ALLOWLIST.includes(path),
    );
    expect(
      extra,
      'spec paths with no implementation; allowlist one only with a stated reason',
    ).toEqual([]);
  });

  it('keeps docs/openapi.yaml path coverage identical to docs/openapi.json', () => {
    const yaml = fs.readFileSync('docs/openapi.yaml', 'utf8');
    const yamlPaths = unique(
      [...yaml.matchAll(/^ {2}(\/[^:\s]+):$/gm)].map((match) => match[1]),
    );
    expect(yamlPaths, 'docs/openapi.yaml must document the same path set as docs/openapi.json').toEqual(
      specPaths,
    );
  });

  it('parses the same route table from the compiled server when dist/ exists', () => {
    if (!fs.existsSync(COMPILED_SERVER)) {
      // Plain `npm test` without `npm run build` has no compiled artifact to
      // compare against; `npm run check` builds before testing, so CI always
      // exercises this assertion.
      return;
    }
    const compiled = unique(implementedPaths(fs.readFileSync(COMPILED_SERVER, 'utf8')));
    expect(compiled, 'compiled dist/http-server.js drifted from src/http-server.ts routes').toEqual(
      implemented,
    );
  });

  it('documents the initialize-before-tools/list requirement on /mcp', () => {
    const description = spec.paths?.['/mcp']?.post?.description ?? '';
    expect(description).toContain('initialize first');
    expect(description).toContain('-32000');
  });

  it('documents the /v1/ask SSE event vocabulary and the guarded field on done', () => {
    const stream = spec.components?.schemas?.AskSseStream?.description ?? '';
    for (const event of ['status', 'tool_call', 'tool_result', 'text', 'receipt', 'done']) {
      expect(stream, `AskSseStream must document the ${event} event`).toContain(`- ${event}:`);
    }
    expect(stream).toContain('guarded');
  });

  it('documents the admin-gated 404 on GET /events', () => {
    const description = spec.paths?.['/events']?.get?.description ?? '';
    expect(description).toContain('404');
  });
});
