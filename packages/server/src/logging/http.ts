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
 * Terminal error handler. Express routes that call `next(err)` (or throw in an async
 * wrapper) land here. We log the full error — message, cause chain, and stack — so a
 * 502 finally explains itself, then return a clean JSON body to the client.
 *
 * Must be registered LAST, after all routes.
 */
export function errorLogger(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const detail = describeError(err);
  log.error(`✗ ${req.method} ${req.originalUrl}`, {
    message: detail.message,
    cause: detail.cause,
  });
  if (detail.stack) log.debug(detail.stack);

  if (!res.headersSent) {
    res.status(500).json({ error: 'internal server error' });
  }
}
