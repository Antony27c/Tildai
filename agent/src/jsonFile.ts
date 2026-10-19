import { mkdirSync, readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { dirname } from "node:path";

/** Reads a JSON file; a missing file returns undefined and anything else throws a clear "corrupt" error. */
export function leerJson(file: string, queEs: string): any {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`El archivo ${queEs} está corrupto (${file}): ${(e as Error).message}`);
  }
}

/** Atomic JSON write via a tmp file + fsync + rename, so a crash never leaves a torn file. */
export async function escribirJsonAtomico(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const f = await open(tmp, "w");
  try {
    await f.writeFile(JSON.stringify(data, null, 2), "utf8");
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(tmp, file);
}
