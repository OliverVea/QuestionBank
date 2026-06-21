import type { ImageMimeType } from '../llm/image-ref.js';
import { log } from '../logging/logger.js';

/** One figure outline the detector returned, in rectified-image pixel coords. */
export interface DetectedFigure {
  /** Detector ordinal (reading order); transient — not the persisted Figure.id. */
  id: number;
  /** [x1, y1, x2, y2] in the rectified image. */
  box: [number, number, number, number];
  score: number;
}

/** The rectified page + its detected figures, as the client type (camelCase). */
export interface ProcessResult {
  rectified: { pngBase64: string; width: number; height: number };
  figures: DetectedFigure[];
}

/** Raised on any non-2xx / timeout / malformed response from figure-service. */
export class FigureServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FigureServiceError';
  }
}

export interface FigureServiceClient {
  /** POST multipart {file} to /v1/process. Throws FigureServiceError on non-2xx/timeout. */
  process(image: Buffer, mime: ImageMimeType): Promise<ProcessResult>;
}

/** Hard cap on a single /v1/process request — dewarp + detect can be slow on CPU. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Map the service's snake_case /v1/process response to the camelCase client type. */
function toProcessResult(raw: unknown): ProcessResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new FigureServiceError('figure-service response is not an object');
  }
  const r = raw as Record<string, unknown>;
  const rectified = r.rectified as Record<string, unknown> | undefined;
  if (
    !rectified ||
    typeof rectified.png_base64 !== 'string' ||
    typeof rectified.width !== 'number' ||
    typeof rectified.height !== 'number'
  ) {
    throw new FigureServiceError('figure-service response missing rectified image');
  }
  const rawFigures = Array.isArray(r.figures) ? r.figures : [];
  const figures: DetectedFigure[] = [];
  for (const f of rawFigures) {
    if (typeof f !== 'object' || f === null) continue;
    const fig = f as Record<string, unknown>;
    const box = fig.box;
    if (typeof fig.id !== 'number' || !Array.isArray(box) || box.length !== 4) continue;
    figures.push({
      id: fig.id,
      box: [Number(box[0]), Number(box[1]), Number(box[2]), Number(box[3])],
      score: typeof fig.score === 'number' ? fig.score : 0,
    });
  }
  return {
    rectified: {
      pngBase64: rectified.png_base64,
      width: rectified.width,
      height: rectified.height,
    },
    figures,
  };
}

/** Build a client bound to a base URL (+ optional API key). */
export function figureServiceClient(baseUrl: string, apiKey?: string): FigureServiceClient {
  const url = baseUrl.replace(/\/+$/, '') + '/v1/process';
  return {
    async process(image: Buffer, mime: ImageMimeType): Promise<ProcessResult> {
      const form = new FormData();
      // The service ignores the filename but multipart needs one; the extension hints the type.
      form.append('file', new Blob([new Uint8Array(image)], { type: mime }), 'page');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: form,
          headers: apiKey ? { 'X-API-Key': apiKey } : {},
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new FigureServiceError(`figure-service returned ${res.status}`);
        }
        const json = (await res.json()) as unknown;
        return toProcessResult(json);
      } catch (err) {
        if (err instanceof FigureServiceError) throw err;
        log.warn('figure-service request failed', { error: (err as Error).message });
        throw new FigureServiceError('figure-service request failed', { cause: err });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Build a client from the cluster env (`FIGURE_SERVICE_URL`, `FIGURE_SERVICE_API_KEY`).
 * Returns null when the URL is unset (local dev w/o the service) — `/api/scan` then runs
 * extraction only and reports `figuresError`.
 */
export function figureServiceFromEnv(env = process.env): FigureServiceClient | null {
  const baseUrl = env.FIGURE_SERVICE_URL;
  if (!baseUrl || baseUrl.trim() === '') return null;
  const apiKey = env.FIGURE_SERVICE_API_KEY;
  return figureServiceClient(baseUrl, apiKey && apiKey.trim() !== '' ? apiKey : undefined);
}
