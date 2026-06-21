import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Canonical v4-ish UUID shape — the only id we ever turn into a filesystem path. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Owns `<dataDir>/imgs/`, one webp crop per figure (`imgs/<figureId>.webp`). A thin blob
 * wrapper over the local filesystem, swappable for S3/object storage later behind the same
 * two methods. The Store constructs it so the "Store owns the data dir" invariant holds.
 *
 * Every id is validated against the UUID shape **before** it is turned into a path, so a
 * crafted id like `../../books` can never escape `imgs/` — defense-in-depth on top of the
 * route-level customer-scope check.
 */
export class FigureBlobs {
  private constructor(private readonly dir: string) {}

  static async open(dataDir: string): Promise<FigureBlobs> {
    const dir = join(dataDir, 'imgs');
    await mkdir(dir, { recursive: true });
    return new FigureBlobs(dir);
  }

  /** Absolute path of a figure's crop. Throws on any non-UUID id (no traversal). */
  path(figureId: string): string {
    if (!UUID_RE.test(figureId)) {
      throw new Error(`figure blob id is not a UUID: ${figureId}`);
    }
    return join(this.dir, `${figureId}.webp`);
  }

  async put(figureId: string, bytes: Buffer): Promise<void> {
    await writeFile(this.path(figureId), bytes);
  }

  /** Remove a crop; a missing file is a no-op (idempotent delete). */
  async delete(figureId: string): Promise<void> {
    try {
      await unlink(this.path(figureId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
