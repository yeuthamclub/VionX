// Reads a library package from a directory or a .zip into the in-memory file map the parser uses.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import type { PackageFiles } from '../../packages/contracts/src/library-package.ts';

export function readPackageDir(dir: string): PackageFiles {
  const files: PackageFiles = {};
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name !== '.DS_Store')
        files[relative(dir, full).split('\\').join('/')] = readFileSync(full);
    }
  };
  walk(dir);
  return files;
}

export function readPackage(path: string): PackageFiles {
  return statSync(path).isDirectory() ? readPackageDir(path) : unzipSync(readFileSync(path));
}

/** Zips a package directory (what the admin import page uploads). */
export function zipPackageDir(dir: string): Uint8Array {
  const files = readPackageDir(dir);
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, data]) => [name, new Uint8Array(data)])),
  );
}
