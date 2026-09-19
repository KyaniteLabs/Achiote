/**
 * `achiote purge`: delete Achiote's local on-disk stores.
 *
 * Achiote never persists raw user food memories (see docs/PRIVACY-RETENTION.md). The only local stores
 * are: the research cache (dish/region research, no personal text), the billing DB (Stripe ids + API key
 * hashes, server-only), and the optional rate-limit DB (hashed counters). This subcommand gives operators
 * a documented, scriptable way to wipe those stores, for example before handing off a machine or rotating
 * an environment.
 *
 * Safe by default: with no `--yes` it performs a DRY RUN and only reports what WOULD be deleted. Pass
 * `--yes` to actually delete. SQLite WAL/SHM sidecar files are removed alongside each `.db`.
 */
import fs from 'node:fs';
import { defaultCachePath } from './lib/cache-path.js';
import { defaultBillingDbPath } from './lib/billing-db.js';

export type PurgeTarget = {
  label: string;
  path: string;
  note: string;
};

export type PurgeOptions = {
  /** When false (default) this is a dry run: report only, delete nothing. */
  confirm: boolean;
  /** Where human-readable output goes. Defaults to process.stdout. */
  out?: NodeJS.WritableStream;
};

/** The local SQLite stores Achiote may create, resolved from env/defaults. None hold raw memories. */
export function purgeTargets(): PurgeTarget[] {
  const targets: PurgeTarget[] = [
    {
      label: 'research cache',
      path: defaultCachePath(),
      note: 'dish/region research records (no personal memory text)',
    },
    {
      label: 'billing database',
      path: defaultBillingDbPath(),
      note: 'Stripe ids + hashed API keys (server billing only)',
    },
  ];
  const rateLimitDb = process.env.ACHIOTE_RATE_LIMIT_DB?.trim();
  if (rateLimitDb) {
    targets.push({
      label: 'rate-limit database',
      path: rateLimitDb,
      note: 'hashed rate-limit counters (no personal data)',
    });
  }
  return targets;
}

/** The `.db` file plus its SQLite WAL/SHM sidecars. */
function filesFor(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
}

/**
 * Run the purge. Returns the process exit code: 0 on success or dry run, 1 if any deletion failed so
 * automation can detect a partial purge.
 */
export function runPurgeCommand(options: PurgeOptions): number {
  const out = options.out ?? process.stdout;
  const targets = purgeTargets();
  let removedAny = false;
  let failed = false;

  out.write(options.confirm ? 'Purging local Achiote stores:\n' : 'Dry run. Local Achiote stores that WOULD be purged (pass --yes to delete):\n');

  for (const target of targets) {
    const existing = filesFor(target.path).filter((file) => fs.existsSync(file));
    if (existing.length === 0) {
      out.write(`  - ${target.label}: not present (${target.path})\n`);
      continue;
    }
    if (!options.confirm) {
      out.write(`  - ${target.label}: ${target.path} (${target.note})\n`);
      continue;
    }
    for (const file of existing) {
      try {
        fs.rmSync(file, { force: true });
        removedAny = true;
      } catch (err) {
        failed = true;
        out.write(`  ! failed to remove ${file}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
    out.write(`  - ${target.label}: removed (${target.path})\n`);
  }

  if (!options.confirm) {
    out.write('\nNothing was deleted. Re-run with "achiote purge --yes" to actually remove these files.\n');
  } else if (failed) {
    out.write('\nSome local stores could not be removed (see the failures above). Re-run after resolving permissions, or remove them manually.\n');
  } else if (!removedAny) {
    out.write('\nNo local stores were present to remove.\n');
  } else {
    out.write('\nLocal stores removed. Note: raw food memories were never persisted (see docs/PRIVACY-RETENTION.md).\n');
  }

  return failed ? 1 : 0;
}
