import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestLogger } from './http.js';

/**
 * Drive `requestLogger` against fake req/res and return the finish-time log lines,
 * split by console channel. `res` is an EventEmitter so emitting 'finish' fires the
 * handler the middleware registers.
 */
function run(method: string, path: string, statusCode: number) {
  const req = { method, path, originalUrl: path } as unknown as Request;
  const res = new EventEmitter() as unknown as Response & EventEmitter;
  res.statusCode = statusCode;
  const next = vi.fn() as unknown as NextFunction;

  requestLogger(req, res, next);
  (res as EventEmitter).emit('finish');

  return { next };
}

describe('requestLogger health-probe noise', () => {
  const prevLevel = process.env.QB_LOG_LEVEL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // info level: debug lines are gated out, info/warn/error are not. This is the
    // production default, so it's exactly the level the noise reduction must hold at.
    process.env.QB_LOG_LEVEL = 'info';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    if (prevLevel === undefined) delete process.env.QB_LOG_LEVEL;
    else process.env.QB_LOG_LEVEL = prevLevel;
  });

  it('does not log a finish line for a successful /api/health probe at info level', () => {
    run('GET', '/api/health', 200);
    // The `←` finish line must be debug (gated out at info). The `→` arrival line is
    // already debug, so nothing should reach console at info.
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still logs a finish line for a successful normal request at info level', () => {
    run('POST', '/api/grade', 200);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('← POST /api/grade');
  });

  it('still logs a failing /api/health probe at error level (5xx)', () => {
    run('GET', '/api/health', 503);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('← GET /api/health');
  });

  it('still logs a failing /api/health probe at warn level (4xx)', () => {
    run('GET', '/api/health', 429);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('← GET /api/health');
  });
});
