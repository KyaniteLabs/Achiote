import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_DEV_ADVISORIES,
  advisoryId,
  advisoryMap,
  evaluateAudit,
  parseAuditReport,
  severityRank,
} from '../scripts/lib/audit-gate.mjs';

const PICOMATCH_URL = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';

function auditReport(vulnerabilities: Record<string, unknown>) {
  return { vulnerabilities };
}

function picomatchChain() {
  return {
    '@vitejs/plugin-react': { severity: 'high', via: ['vite'] },
    fdir: { severity: 'high', via: ['picomatch'] },
    picomatch: {
      severity: 'high',
      via: [{ source: 1106944, url: PICOMATCH_URL, severity: 'high', title: 'ReDoS through repeated extglobs', range: '<=4.0.7' }],
    },
    tinyglobby: { severity: 'high', via: ['fdir', 'picomatch'] },
    vite: { severity: 'high', via: ['picomatch', 'tinyglobby'] },
    vitest: { severity: 'high', via: ['picomatch', 'tinyglobby', 'vite'] },
  };
}

describe('dependency audit gate policy', () => {
  it('ranks severities so moderate and worse can be compared numerically', () => {
    expect(severityRank('info')).toBeLessThan(severityRank('low'));
    expect(severityRank('low')).toBeLessThan(severityRank('moderate'));
    expect(severityRank('moderate')).toBeLessThan(severityRank('high'));
    expect(severityRank('high')).toBeLessThan(severityRank('critical'));
    expect(severityRank('unknown')).toBe(-1);
  });

  it('extracts the GHSA identifier from an advisory URL', () => {
    expect(advisoryId(PICOMATCH_URL)).toBe('GHSA-fc5q-39xc-vjpf');
    expect(advisoryId('https://example.com/not-an-advisory')).toBeNull();
    expect(advisoryId(undefined)).toBeNull();
  });

  it('resolves transitive via chains to the advisory that reaches each package', () => {
    const map = advisoryMap(picomatchChain());

    expect([...map.keys()]).toEqual(['GHSA-fc5q-39xc-vjpf']);
    const advisory = map.get('GHSA-fc5q-39xc-vjpf')!;
    expect([...advisory.packages].sort()).toEqual([
      '@vitejs/plugin-react',
      'fdir',
      'picomatch',
      'tinyglobby',
      'vite',
      'vitest',
    ]);
  });

  it('blocks a production advisory even when its identifier is on the accepted list', () => {
    const result = evaluateAudit({
      allAudit: auditReport({ picomatch: picomatchChain().picomatch }),
      prodAudit: auditReport({ picomatch: picomatchChain().picomatch }),
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ id: 'GHSA-fc5q-39xc-vjpf', scope: 'production' });
    expect(result.accepted).toHaveLength(0);
  });

  it('accepts a dev-only advisory that is on the accepted list with a live review date', () => {
    const result = evaluateAudit({
      allAudit: auditReport(picomatchChain()),
      prodAudit: auditReport({}),
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.blocked).toHaveLength(0);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toMatchObject({ id: 'GHSA-fc5q-39xc-vjpf', scope: 'development' });
    expect(result.accepted[0].reason).toBeTruthy();
  });

  it('blocks a dev-only advisory that is not on the accepted list', () => {
    const result = evaluateAudit({
      allAudit: auditReport(picomatchChain()),
      prodAudit: auditReport({}),
      accepted: [],
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ id: 'GHSA-fc5q-39xc-vjpf', scope: 'development' });
    expect(result.blocked[0].reason).toContain('not listed in the accepted-advisory list');
  });

  it('blocks an accepted advisory once its review-by date has passed', () => {
    const result = evaluateAudit({
      allAudit: auditReport(picomatchChain()),
      prodAudit: auditReport({}),
      accepted: [{ ...ACCEPTED_DEV_ADVISORIES[0], reviewBy: '2026-11-01' }],
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].reason).toContain('review-by date');
    expect(result.accepted).toHaveLength(0);
  });

  it('does not block advisories below the moderate threshold', () => {
    const result = evaluateAudit({
      allAudit: auditReport({
        picomatch: {
          severity: 'low',
          via: [{ source: 1, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'low', title: 'minor' }],
        },
      }),
      prodAudit: auditReport({}),
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.blocked).toHaveLength(0);
    expect(result.belowThreshold).toHaveLength(1);
  });

  it('reports an accepted advisory that npm no longer lists so the entry can be removed', () => {
    const result = evaluateAudit({
      allAudit: auditReport({}),
      prodAudit: auditReport({}),
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.staleAcceptances).toContain('GHSA-fc5q-39xc-vjpf');
  });

  it('keeps the accepted list limited to the documented advisory with a reason and review date', () => {
    expect(ACCEPTED_DEV_ADVISORIES.map((entry) => entry.id)).toEqual(['GHSA-fc5q-39xc-vjpf']);
    for (const entry of ACCEPTED_DEV_ADVISORIES) {
      expect(entry.reason).toBeTruthy();
      expect(Number.isNaN(Date.parse(`${entry.reviewBy}T23:59:59Z`))).toBe(false);
    }
  });

  it('counts an advisory that has no GHSA URL instead of dropping it', () => {
    // npm reports older advisories under npmjs.com/advisories/<id>. If those are
    // skipped rather than counted, a real finding would go unreported.
    const map = advisoryMap({
      oldpkg: {
        severity: 'high',
        via: [{ source: 1, url: 'https://npmjs.com/advisories/1234', severity: 'high', title: 'legacy advisory' }],
      },
    });

    expect(map.size).toBe(1);
    const [key, advisory] = [...map.entries()][0];
    expect(key).toContain('1234');
    expect(advisory.severity).toBe('high');
    expect([...advisory.packages]).toEqual(['oldpkg']);
  });

  it('counts an advisory that carries no URL at all', () => {
    const map = advisoryMap({
      oddpkg: { severity: 'moderate', via: [{ source: 2, severity: 'moderate', title: 'no url' }] },
    });

    expect(map.size).toBe(1);
  });

  it('fails closed when the audit request itself failed and returned no vulnerability data', () => {
    // npm returns JSON with an error payload (and no vulnerabilities map) when the
    // registry or the audit endpoint is unreachable. Reading that as "no advisories"
    // would let the gate pass without ever checking anything.
    const failedRequest = JSON.stringify({
      message: 'request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed, reason: connect ECONNREFUSED',
      error: { summary: '', detail: '' },
    });

    expect(() => parseAuditReport(failedRequest, 1, 'npm error audit endpoint returned an error')).toThrow(
      /could not evaluate dependencies/,
    );
    expect(() => parseAuditReport('not json at all', 1, 'npm error')).toThrow(/did not return a JSON report/);
    expect(() => parseAuditReport('{}', 0, '')).toThrow(/could not evaluate dependencies/);
  });

  it('accepts a real audit report with an empty vulnerability map', () => {
    const report = parseAuditReport(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }), 0, '');
    expect(report.vulnerabilities).toEqual({});
  });
});
