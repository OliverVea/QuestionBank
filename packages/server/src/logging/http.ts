import type { NextFunction, Request, Response } from 'express';
import { describeError, log } from './logger.js';

/**
 * Per-request logger. Logs a `→` line when a request arrives and a `←` line when the
 * response finishes, with status, duration, and the FULL original URL (not the
 * router-relative path — that's why bare middleware logged useless `POST /`).
 *
 * Status drives the level: 5xx → error, 4xx → warn, else info. So a failing
 * transcription stands out in red instead of scrolling past as plain text.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  log.debug(`→ ${req.method} ${req.originalUrl}`);

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const ctx = { status: res.statusCode, ms: Math.round(ms) };
    const line = `← ${req.method} ${req.originalUrl}`;
    if (res.statusCode >= 500) log.error(line, ctx);
    else if (res.statusCode >= 400) log.warn(line, ctx);
    else log.info(line, ctx);
  });

  next();
}

/**
 * Pull a client-error status off a thrown value. Express's body-parser tags malformed
 * input (e.g. unparseable JSON) with `status`/`statusCode` in the 4xx range and
 * `expose: true`; honoring it turns those into a 400 instead of a misleading 500.
 * Anything without a 4xx status is treated as a genuine server fault (500).
 */
function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { status?: unknown; statusCode?: unknown };
  const status = typeof e.status === 'number' ? e.status : e.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) return status;
  return undefined;
}

/**
 * Terminal error handler. Express routes that call `next(err)` (or throw in an async
 * wrapper) land here, as do body-parser failures on malformed request bodies. Client
 * errors (4xx) are logged as warnings and echo their message back; everything else is
 * a server fault — logged in full (message, cause chain, stack) and returned as a 500.
 *
 * Must be registered LAST, after all routes.
 */
export function errorLogger(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const detail = describeError(err);
  const clientStatus = clientErrorStatus(err);

  if (clientStatus !== undefined) {
    log.warn(`✗ ${req.method} ${req.originalUrl}`, {
      status: clientStatus,
      message: detail.message,
    });
    if (!res.headersSent) {
      res.status(clientStatus).json({ error: detail.message });
    }
    return;
  }

  log.error(`✗ ${req.method} ${req.originalUrl}`, {
    message: detail.message,
    cause: detail.cause,
  });
  if (detail.stack) log.debug(detail.stack);

  if (!res.headersSent) {
    res.status(500).json({ error: 'internal server error' });
  }
}
