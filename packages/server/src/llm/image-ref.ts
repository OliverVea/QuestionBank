import { readFile } from 'node:fs/promises';

/** Accepted image media types across providers. */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/**
 * A reference to image bytes the provider resolves only when it serializes a turn.
 * Decouples bytes from location: file now, in-memory now, S3 later — the provider
 * never branches on the kind, it just calls `load()`.
 */
export interface ImageRef {
  mimeType: ImageMimeType;
  load(): Promise<Buffer>;
}

/** An ImageRef whose bytes are read from an absolute path on `load()`. */
export function fileImage(absolutePath: string, mimeType: ImageMimeType): ImageRef {
  return { mimeType, load: () => readFile(absolutePath) };
}

/** An ImageRef backed by an in-memory buffer (no disk read). */
export function bufferImage(bytes: Buffer, mimeType: ImageMimeType): ImageRef {
  return { mimeType, load: () => Promise.resolve(bytes) };
}
