import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root for both a git checkout and an installed tarball (parent of scripts/). */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Resolve a package-relative path. Packaged installs do not have a useful cwd. */
export function repoInput(relativePath) {
  return path.join(packageRoot, relativePath);
}
