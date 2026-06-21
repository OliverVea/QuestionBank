import type { ImageMimeType } from '../llm/image-ref.js';
import type { FigureServiceClient, ProcessResult } from './figure-service-client.js';

/**
 * Deterministic figure-service for tests — never hits the network. Returns a fixed
 * ProcessResult per call; `failWith()` makes the next call throw. Records each call's
 * mime so tests can assert what was sent.
 */
export class FakeFigureService implements FigureServiceClient {
  private error: Error | undefined;
  calls: ImageMimeType[] = [];

  constructor(private readonly result: ProcessResult = DEFAULT_RESULT) {}

  /** Make the next process() reject (simulates a figure-service outage). */
  failWith(error: Error): void {
    this.error = error;
  }

  async process(_image: Buffer, mime: ImageMimeType): Promise<ProcessResult> {
    this.calls.push(mime);
    if (this.error) throw this.error;
    return this.result;
  }
}

/** A 1×1 transparent PNG, base64 — enough for sharp to decode in tests. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const DEFAULT_RESULT: ProcessResult = {
  rectified: { pngBase64: TINY_PNG_B64, width: 1, height: 1 },
  figures: [{ id: 0, box: [0, 0, 1, 1], score: 0.9 }],
};
