import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where a saved image lives, both as a portable relative path and an absolute one. */
export interface SavedImage {
  /** Relative to the data dir, e.g. `images/<uuid>.png` — stored on QuestionSource. */
  imagePath: string;
  /** Absolute path on the server machine — what a provider needs to read the file. */
  absolutePath: string;
}

/**
 * Owns `<dataDir>/images/`. Mirrors Store/JsonCollection: owns its directory and
 * lazy-creates it on first write. The relative `imagePath` is what lands in
 * QuestionSource.imagePath; the absolute path is what the provider reads.
 */
export class ImageStore {
  private readonly imagesDir: string;

  constructor(private readonly dataDir: string) {
    this.imagesDir = join(dataDir, 'images');
  }

  /** Absolute path to the images directory (used to grant the CLI read access). */
  get directory(): string {
    return this.imagesDir;
  }

  /** Write the buffer as `<uuid>.<ext>` and return its relative + absolute paths. */
  async save(buffer: Buffer, ext: string): Promise<SavedImage> {
    await mkdir(this.imagesDir, { recursive: true });
    const fileName = `${randomUUID()}.${ext}`;
    const absolutePath = join(this.imagesDir, fileName);
    await writeFile(absolutePath, buffer);
    return { imagePath: join('images', fileName), absolutePath };
  }
}
