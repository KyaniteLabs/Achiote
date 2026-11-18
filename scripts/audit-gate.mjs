#!/usr/bin/env node
/**
 * Dependency-audit gate.
 *
 * Runs `npm audit` twice — once over the full tree and once over the
 * production tree — then applies the policy in scripts/lib/audit-gate.mjs:
 *
 *   - A production dependency advisory at moderate or worse fails the gate.
 *   - A dev-dependency advisory at moderate or worse fails the gate unless it
 *     is listed in ACCEPTED_DEV_ADVISORIES with a written reason and a
 *     review-by date that has not passed.
 *
 * Every advisory found is printed, so accepted and below-threshold findings
 * stay visible instead of disappearing behind the exit code.
 *
 * Exit codes: 0 = gate passed, 1 = gate failed, 2 = the audit could not run.
 */
import { spawnSync } from 'node:child_process';
import { evaluateAudit, parseAuditReport, DEFAULT_BLOCKING_SEVERITY } from './lib/audit-gate.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runAudit(args) {
  const result = spawnSync(npmCommand, ['audit', '--json', ...args], { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`npm audit could not start: ${result.error.message}`);
  }
  if (result.status === null) {
    throw new Error(`npm audit was terminated by signal ${result.signal}`);
  }
  // npm audit exits 1 when it finds advisories; the report is still on stdout.
  return parseAuditReport(result.stdout, result.status, result.stderr ?? '');
}

function describe(record) {
  return `${record.id} (${record.severity}) ${record.packages.join(', ')}${record.title ? ` — ${record.title}` : ''}`;
}

function main() {
  let allAudit;
  let prodAudit;
  try {
    allAudit = runAudit([]);
    prodAudit = runAudit(['--omit=dev']);
  } catch (error) {
    console.error(`Audit gate could not evaluate: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const result = evaluateAudit({ allAudit, prodAudit, blockingSeverity: DEFAULT_BLOCKING_SEVERITY });

  console.log(`Audit gate: ${result.accepted.length} accepted dev advisory(ies), ${result.belowThreshold.length} below threshold, ${result.blocked.length} blocking.`);

  for (const record of result.accepted) {
    console.log(`accepted: ${describe(record)} — review by ${record.reviewBy}. ${record.reason}`);
  }
  for (const record of result.belowThreshold) {
    console.log(`below threshold (${record.scope}): ${describe(record)}`);
  }
  for (const id of result.staleAcceptances) {
    console.log(`stale accepted advisory: ${id} is no longer reported by npm audit; remove it from the accepted list.`);
  }
  for (const record of result.blocked) {
    console.error(`BLOCKED (${record.scope}): ${describe(record)} — ${record.reason}`);
  }

  if (result.blocked.length > 0) {
    console.error('Audit gate failed. See SECURITY.md for the accepted-dev-advisory process.');
    return 1;
  }
  console.log('Audit gate passed.');
  return 0;
}

process.exit(main());
