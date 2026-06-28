import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireAuth, requireCustomerId, verifierFromEnv } from './require-auth.js';
import type { VerifyBearer } from './verify-bearer.js';

function appWith(verify: VerifyBearer): express.Express {
  const app = express();
  app.use('/api', requireAuth(verify));
  app.get('/api/whoami', (req, res) => {
    res.json({ customerId: requireCustomerId(req) });
  });
  return app;
}

const ok: VerifyBearer = async (token) => {
  if (!token) throw new Error('no token');
  return { customerId: 'cust-7', claims: { sub: 'cust-7' } };
};

describe('requireAuth', () => {
  it('401s when no Authorization header is present', async () => {
    const res = await request(appWith(ok)).get('/api/whoami');
    expect(res.status).toBe(401);
  });

  it('401s when the verifier rejects the token', async () => {
    const reject: VerifyBearer = async () => {
      throw new Error('bad token');
    };
    const res = await request(appWith(reject)).get('/api/whoami').set('Authorization', 'Bearer x');
    expect(res.status).toBe(401);
  });

  it('passes and sets req.customerId on a valid token', async () => {
    const res = await request(appWith(ok)).get('/api/whoami').set('Authorization', 'Bearer good');
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe('cust-7');
  });
});

describe('verifierFromEnv', () => {
  it('builds without throwing even when env is unset (lazy)', () => {
    expect(() => verifierFromEnv({})).not.toThrow();
  });
});
