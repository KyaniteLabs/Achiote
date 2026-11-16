import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load `<dir>/.env` into process.env (existing variables win). A missing file is fine.
 */
export function loadEnvFrom(dir: string): void {
  try {
    process.loadEnvFile(path.join(dir, '.env'));
  } catch {
    /* no .env file present */
  }
}

/**
 * Load the .env that sits in the package directory, never the current working directory.
 * Hosts start this server from the user's project, so a cwd .env would feed unrelated
 * secrets (or an attacker-chosen ANTHROPIC_BASE_URL) into the process.
 * Works from both src/lib (tests) and dist/lib (published build): the package root is two levels up.
 */
export function loadPackageEnv(): void {
  loadEnvFrom(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
}
