/**
 * Dependency-audit gate policy.
 *
 * Two rules, both enforced by scripts/audit-gate.mjs:
 *
 *  1. Production dependencies (the ones this package ships) block on any
 *     moderate-or-worse advisory. There is no accepted list for production.
 *  2. Dev-toolchain advisories block too, unless they are listed in
 *     ACCEPTED_DEV_ADVISORIES with a written reason, a review-by date, and a
 *     declared severity ceiling: an acceptance only covers the severity it
 *     was written for, so an advisory re-rated above that ceiling blocks
 *     until the acceptance is re-evaluated. That keeps new dev advisories
 *     from slipping through as warnings, while allowing the one advisory
 *     that has no upstream fix.
 *
 * Both rules fail closed on severity: an advisory whose severity is missing
 * or unrecognized cannot be ranked, so it is treated as blocking rather than
 * below-threshold — in either scope.
 *
 * Every accepted advisory must also be documented in SECURITY.md, and its
 * review-by date forces a revisit instead of a permanent silent exception.
 */

export const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
export const DEFAULT_BLOCKING_SEVERITY = 'moderate';

/**
 * Accepted dev-dependency advisories. Adding an entry is a deliberate,
 * reviewed decision: name the advisory, say why it cannot be fixed today,
 * declare the severity ceiling the acceptance covers, and set a review-by
 * date so the exception is re-examined on a schedule. An advisory re-rated
 * above the declared ceiling blocks until the acceptance is re-evaluated.
 *
 * Currently empty: GHSA-fc5q-39xc-vjpf (picomatch ReDoS) was withdrawn
 * upstream on 2026-11-18 (OSV `withdrawn`), npm audit stopped reporting it,
 * and the entry was removed via the gate's stale-acceptance path. If that
 * advisory — or any successor — returns, the gate fails closed until a
 * fresh acceptance is written. SECURITY.md records the 2026-11-18
 * evaluation and the closure.
 */
export const ACCEPTED_DEV_ADVISORIES = [];

export function severityRank(severity) {
  const index = SEVERITY_ORDER.indexOf(String(severity ?? '').toLowerCase());
  return index === -1 ? -1 : index;
}

/**
 * Extract the GHSA identifier from an advisory URL. Returns null when absent.
 */
export function advisoryId(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})\b/i);
  if (!match) return null;
  // Canonical form: uppercase GHSA prefix, lower-case remainder. Lookups against
  // the accepted list are case-insensitive on top of this.
  const body = match[1].slice('GHSA-'.length);
  return `GHSA-${body.toLowerCase()}`;
}

/**
 * Stable key for an advisory that has no GHSA identifier.
 *
 * npm reports older advisories under npmjs.com/advisories/<id> URLs. Those
 * advisories must still be counted — dropping them would hide a finding — so
 * they are keyed by their source URL instead.
 */
export function advisoryKeyFromUrl(url) {
  const id = advisoryId(url);
  if (id) return id;
  return `url:${String(url ?? 'unknown').toLowerCase()}`;
}

/**
 * Map every advisory in an `npm audit --json` report to the packages it
 * reaches. `via` entries are either advisory objects or names of other
 * vulnerable packages, so the chain is resolved transitively.
 */
export function advisoryMap(vulnerabilities) {
  const entries = vulnerabilities ?? {};
  const direct = new Map();
  for (const [name, entry] of Object.entries(entries)) {
    const found = [];
    for (const via of entry?.via ?? []) {
      if (via && typeof via === 'object') {
        // An advisory with no usable URL still has to be counted. Key it by a
        // stable placeholder so it is reported and blocks rather than vanishing.
        const key = via.url ? advisoryKeyFromUrl(via.url) : `unnamed:${name}:${via.title ?? ''}`.toLowerCase();
        found.push({
          id: key,
          severity: String(via.severity ?? entry?.severity ?? '').toLowerCase(),
          title: via.title ?? '',
          url: via.url ?? '',
        });
      }
    }
    direct.set(name, found);
  }

  const resolved = new Map();
  const resolve = (name, stack = new Set()) => {
    if (resolved.has(name)) return resolved.get(name);
    if (stack.has(name)) return [];
    stack.add(name);
    const merged = new Map();
    for (const item of direct.get(name) ?? []) merged.set(item.id, item);
    for (const via of entries[name]?.via ?? []) {
      if (typeof via !== 'string') continue;
      for (const item of resolve(via, stack)) merged.set(item.id, item);
    }
    const list = [...merged.values()];
    resolved.set(name, list);
    return list;
  };

  const map = new Map();
  for (const name of Object.keys(entries)) {
    for (const item of resolve(name)) {
      const current = map.get(item.id);
      if (!current) {
        map.set(item.id, { ...item, packages: new Set([name]) });
        continue;
      }
      current.packages.add(name);
      if ([severityRank(current.severity), severityRank(item.severity)].some((rank) => rank < 0)) {
        // One sighting without a recognizable severity means the advisory's
        // true severity is unknown. Keep it unknown so the policy blocks
        // instead of trusting whichever severity happened to be seen first.
        current.severity = '';
      } else if (severityRank(item.severity) > severityRank(current.severity)) {
        current.severity = item.severity;
        current.title = item.title;
        current.url = item.url;
      }
    }
  }
  return map;
}

function packageList(advisory) {
  return [...(advisory.packages ?? [])].sort();
}

function unknownSeverityReason(severity) {
  return `advisory severity is missing or unrecognized (${severity || 'none reported'}); failing closed`;
}

/**
 * Parse and validate an `npm audit --json` report.
 *
 * Throws when the report cannot be trusted:
 *  - not JSON at all,
 *  - an error payload (registry unreachable / endpoint failure), or
 *  - a report with no vulnerability data.
 *
 * npm returns JSON without a vulnerabilities map when the audit request itself
 * fails. Reading that as "no advisories" would let a gate pass without ever
 * checking anything, so it must fail closed instead.
 */
export function parseAuditReport(stdout, exitStatus = 0, stderr = '') {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error(`npm audit did not return a JSON report (exit ${exitStatus}): ${stderr.trim() || stdout.trim()}`);
  }
  if (!report || typeof report !== 'object') {
    throw new Error('npm audit returned an unexpected report shape');
  }
  if (report.error || !report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    const detail = report.error?.summary || report.error?.detail || report.message || 'no vulnerability data in report';
    throw new Error(`npm audit could not evaluate dependencies (exit ${exitStatus}): ${detail}`);
  }
  return report;
}

/**
 * Apply the gate policy to a full-tree audit report and a production-tree
 * audit report.
 */
export function evaluateAudit({
  allAudit,
  prodAudit,
  accepted = ACCEPTED_DEV_ADVISORIES,
  blockingSeverity = DEFAULT_BLOCKING_SEVERITY,
  now = new Date(),
}) {
  const all = advisoryMap(allAudit?.vulnerabilities);
  const prod = advisoryMap(prodAudit?.vulnerabilities);
  const threshold = severityRank(blockingSeverity);

  const blocked = [];
  const acceptedFindings = [];
  const belowThreshold = [];
  const staleAcceptances = [];

  // Rule 1: production dependencies always block.
  for (const [id, advisory] of prod) {
    const record = { id, severity: advisory.severity, title: advisory.title, packages: packageList(advisory) };
    const rank = severityRank(advisory.severity);
    if (rank < 0) {
      blocked.push({ ...record, scope: 'production', reason: unknownSeverityReason(advisory.severity) });
      continue;
    }
    if (rank < threshold) {
      belowThreshold.push({ ...record, scope: 'production' });
      continue;
    }
    blocked.push({ ...record, scope: 'production', reason: 'production dependency advisory has no accepted-risk exemption' });
  }

  // Rule 2: dev-only advisories need an accepted entry.
  for (const [id, advisory] of all) {
    if (prod.has(id)) continue;
    const record = { id, severity: advisory.severity, title: advisory.title, packages: packageList(advisory) };
    const rank = severityRank(advisory.severity);
    if (rank < 0) {
      blocked.push({ ...record, scope: 'development', reason: unknownSeverityReason(advisory.severity) });
      continue;
    }
    if (rank < threshold) {
      belowThreshold.push({ ...record, scope: 'development' });
      continue;
    }
    const entry = accepted.find((item) => String(item.id ?? '').toLowerCase() === String(id ?? '').toLowerCase());
    if (!entry) {
      blocked.push({ ...record, scope: 'development', reason: 'dev-dependency advisory is not listed in the accepted-advisory list' });
      continue;
    }
    // The acceptance is written against a declared severity. If the live
    // advisory is re-rated worse than that ceiling, the written rationale no
    // longer describes the risk, so the gate blocks until it is re-evaluated.
    if (rank > severityRank(entry.severity)) {
      blocked.push({
        ...record,
        scope: 'development',
        reason: `advisory severity '${advisory.severity}' is worse than the accepted ceiling '${entry.severity ?? 'none'}' for ${entry.id}; re-evaluate the acceptance`,
      });
      continue;
    }
    const expiry = Date.parse(`${entry.reviewBy}T23:59:59Z`);
    if (Number.isNaN(expiry)) {
      blocked.push({ ...record, scope: 'development', reason: `accepted advisory has no valid review-by date (${entry.reviewBy})` });
      continue;
    }
    if (now.getTime() > expiry) {
      blocked.push({ ...record, scope: 'development', reason: `accepted-advisory review-by date ${entry.reviewBy} has passed; re-evaluate and update the accepted list` });
      continue;
    }
    acceptedFindings.push({ ...record, scope: 'development', reviewBy: entry.reviewBy, reason: entry.reason });
  }

  for (const entry of accepted) {
    const entryKey = String(entry.id ?? '').toLowerCase();
    if (![...all.keys()].some((id) => String(id).toLowerCase() === entryKey)) {
      staleAcceptances.push(entry.id);
    }
  }

  return { blocked, accepted: acceptedFindings, belowThreshold, staleAcceptances };
}
