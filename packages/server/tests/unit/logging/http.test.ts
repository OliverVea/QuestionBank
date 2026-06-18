import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { errorLogger } from '@/logging/http.js';

/** Minimal Response double that records the status + JSON body the handler sends. */
function fakeRes(): Response & { sent: { status: number; body: unknown } } {
  const res = {
    headersSent: false,
    sent: { status: 0, body: undefined as unknown },
    status(code: number) {
      this.sent.status = code;
      return this;
    },
    json(body: unknown) {
      this.sent.body = body;
      this.headersSent = true;
      return this;
    },
  };
  return res as unknown as Response & { sent: { status: number; body: unknown } };
}

const req = { method: 'POST', originalUrl: '/api/questions/x/grade' } as Request;
const next = vi.fn();

describe('errorLogger', () => {
  // The prod 500: express.json() throws a SyntaxError carrying status 400 on a malformed
  // body, but the handler masked every error as 500. It must now honor the 4xx status.
  it('honors a client-error status set on the thrown error', () => {
    const err = Object.assign(new SyntaxError('Unexpected token in JSON'), {
      status: 400,
      statusCode: 400,
      expose: true,
    });
    const res = fakeRes();
    errorLogger(err, req, res, next);
    expect(res.sent.status).toBe(400);
    expect(res.sent.body).toEqual({ error: 'Unexpected token in JSON' });
  });

  it('falls back to statusCode when status is absent', () => {
    const err = Object.assign(new Error('payload too large'), { statusCode: 413 });
    const res = fakeRes();
    errorLogger(err, req, res, next);
    expect(res.sent.status).toBe(413);
  });

  it('treats a genuine error (no 4xx status) as a 500 with a generic body', () => {
    const res = fakeRes();
    errorLogger(new Error('boom'), req, res, next);
    expect(res.sent.status).toBe(500);
    expect(res.sent.body).toEqual({ error: 'internal server error' });
  });

  it('does not leak a 5xx status carried on the error as a client error', () => {
    const err = Object.assign(new Error('upstream'), { status: 503 });
    const res = fakeRes();
    errorLogger(err, req, res, next);
    expect(res.sent.status).toBe(500);
  });

  it('writes nothing when the response is already sent', () => {
    const res = fakeRes();
    res.headersSent = true;
    errorLogger(new Error('late'), req, res, next);
    expect(res.sent.status).toBe(0);
  });
});
