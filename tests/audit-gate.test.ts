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

// The default accepted list is empty (the picomatch advisory was withdrawn
// upstream on 2026-11-18 and its entry removed). These tests exercise the
// acceptance mechanism with the entry exactly as it was while it was live.
function picomatchAcceptance() {
  return {
    id: 'GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    severity: 'high',
    reviewBy: '2027-02-16',
    reason: 'No fixed picomatch release exists; see SECURITY.md.',
  };
}

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
      accepted: [picomatchAcceptance()],
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
      accepted: [picomatchAcceptance()],
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
      accepted: [{ ...picomatchAcceptance(), reviewBy: '2026-11-01' }],
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].reason).toContain('review-by date');
    expect(result.accepted).toHaveLength(0);
  });

  it('blocks an accepted advisory that is re-rated above the accepted severity ceiling', () => {
    // The acceptance is written against severity 'high'. If the advisory is
    // re-rated 'critical' (this one was modified 2026-11-17, so a re-rate is
    // live), the written rationale no longer describes the risk.
    const result = evaluateAudit({
      allAudit: auditReport({
        picomatch: {
          severity: 'critical',
          via: [{ source: 1106944, url: PICOMATCH_URL, severity: 'critical', title: 'ReDoS through repeated extglobs', range: '<=4.0.7' }],
        },
      }),
      prodAudit: auditReport({}),
      accepted: [picomatchAcceptance()],
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.accepted).toHaveLength(0);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ id: 'GHSA-fc5q-39xc-vjpf', scope: 'development' });
    expect(result.blocked[0].reason).toContain('accepted ceiling');
  });

  it('blocks a dev advisory whose severity is missing or unrecognized instead of treating it as below-threshold', () => {
    const missing = evaluateAudit({
      allAudit: auditReport({
        quiet: { via: [{ source: 7, url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff', title: 'severity omitted' }] },
      }),
      prodAudit: auditReport({}),
      now: new Date('2026-11-18T00:00:00Z'),
    });
    expect(missing.belowThreshold).toHaveLength(0);
    expect(missing.accepted).toHaveLength(0);
    expect(missing.blocked).toHaveLength(1);
    expect(missing.blocked[0]).toMatchObject({ id: 'GHSA-dddd-eeee-ffff', scope: 'development' });
    expect(missing.blocked[0].reason).toContain('failing closed');

    // A severity label outside the known vocabulary is just as unrankable.
    const unrecognized = evaluateAudit({
      allAudit: auditReport({
        odd: { severity: 'severe', via: [{ source: 8, url: 'https://github.com/advisories/GHSA-cccc-dddd-eeee', severity: 'severe', title: 'nonstandard label' }] },
      }),
      prodAudit: auditReport({}),
      now: new Date('2026-11-18T00:00:00Z'),
    });
    expect(unrecognized.belowThreshold).toHaveLength(0);
    expect(unrecognized.blocked).toHaveLength(1);
    expect(unrecognized.blocked[0].reason).toContain('failing closed');
  });

  it('blocks a production advisory whose severity is missing or unrecognized', () => {
    const vulnerabilities = {
      quiet: { via: [{ source: 7, url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff', title: 'severity omitted' }] },
    };
    const result = evaluateAudit({
      allAudit: auditReport(vulnerabilities),
      prodAudit: auditReport(vulnerabilities),
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.belowThreshold).toHaveLength(0);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ id: 'GHSA-dddd-eeee-ffff', scope: 'production' });
    expect(result.blocked[0].reason).toContain('failing closed');
  });

  it('keeps an advisory unrecognized when any sighting of it lacks a severity', () => {
    // The same advisory seen from two packages: one sighting says 'low', the
    // other carries no severity. The merge must not let the 'low' sighting
    // mask the unknown one — the advisory stays unrankable and blocks.
    const url = 'https://github.com/advisories/GHSA-eeee-ffff-gggg';
    const result = evaluateAudit({
      allAudit: auditReport({
        pkga: { severity: 'low', via: [{ source: 1, url, severity: 'low', title: 'sighted low' }] },
        pkgb: { via: [{ source: 1, url, title: 'severity missing here' }] },
      }),
      prodAudit: auditReport({}),
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.belowThreshold).toHaveLength(0);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ id: 'GHSA-eeee-ffff-gggg', scope: 'development' });
    expect(result.blocked[0].reason).toContain('failing closed');
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
      accepted: [picomatchAcceptance()],
      now: new Date('2026-11-18T00:00:00Z'),
    });

    expect(result.staleAcceptances).toContain('GHSA-fc5q-39xc-vjpf');
  });

  it('ships with no accepted advisories; any entry must carry a reason, review date, and rankable severity', () => {
    // Empty is the measured state: the one entry (picomatch GHSA-fc5q-39xc-vjpf)
    // was withdrawn upstream on 2026-11-18 and removed. An empty list means any
    // advisory npm reports fails closed until a written acceptance exists.
    expect(ACCEPTED_DEV_ADVISORIES).toEqual([]);
    for (const entry of ACCEPTED_DEV_ADVISORIES) {
      expect(entry.id).toMatch(/^GHSA-/i);
      expect(entry.reason).toBeTruthy();
      expect(Number.isNaN(Date.parse(`${entry.reviewBy}T23:59:59Z`))).toBe(false);
      expect(severityRank(entry.severity)).toBeGreaterThanOrEqual(0);
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
