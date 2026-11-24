/**
 * Safe local saving for downloaded Canvas files.
 *
 * - Everything is written under CANVAS_DOWNLOAD_DIR (Deno's --allow-write is
 *   also scoped to that directory, so this is enforced twice).
 * - Names coming from Canvas are untrusted: path separators, "..", control
 *   characters and leading dots are stripped so a file can't escape the folder
 *   or become hidden.
 * - Files are created with createNew, so an existing file is never
 *   overwritten; a " (1)", " (2)", ... suffix is used instead.
 */

const MAX_NAME_LENGTH = 180;

export function getDownloadDir(): string {
  const dir = Deno.env.get("CANVAS_DOWNLOAD_DIR");
  if (!dir || !dir.startsWith("/")) {
    throw new Error(
      "CANVAS_DOWNLOAD_DIR is not set to an absolute path. Set it in the launcher script.",
    );
  }
  return dir.replace(/\/+$/, "");
}

/** Make an untrusted name safe to use as a single path segment */
export function sanitizeName(name: string, fallback: string): string {
  let cleaned = name
    .normalize("NFC")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "") // no hidden files, no "." / ".."
    .replace(/[.\s]+$/, "");

  if (cleaned.length > MAX_NAME_LENGTH) {
    const dot = cleaned.lastIndexOf(".");
    const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
    cleaned = cleaned.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  return cleaned || fallback;
}

function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * Write bytes to <downloadDir>/<subfolder>/<fileName> without overwriting.
 * Returns the absolute path actually written.
 */
export async function saveUnique(
  subfolder: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const root = getDownloadDir();
  if (
    !subfolder || subfolder.includes("/") || subfolder.includes("\\") || subfolder.startsWith(".")
  ) {
    throw new Error("Refusing to write outside the download folder");
  }
  const dir = `${root}/${subfolder}`;
  await Deno.mkdir(dir, { recursive: true });

  const [stem, ext] = splitExt(fileName);
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? fileName : `${stem} (${i})${ext}`;
    const path = `${dir}/${candidate}`;

    // Defense in depth: the final path must sit directly inside dir
    if (!path.startsWith(root + "/") || candidate.includes("/") || candidate.startsWith(".")) {
      throw new Error("Refusing to write outside the download folder");
    }

    let file: Deno.FsFile;
    try {
      file = await Deno.open(path, { write: true, createNew: true });
    } catch (e) {
      if (e instanceof Deno.errors.AlreadyExists) continue;
      throw e;
    }
    try {
      let written = 0;
      while (written < bytes.length) {
        written += await file.write(bytes.subarray(written));
      }
    } catch (e) {
      file.close();
      await Deno.remove(path).catch(() => {});
      throw e;
    }
    file.close();
    return path;
  }
  throw new Error(`Too many files named "${fileName}" already exist`);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
