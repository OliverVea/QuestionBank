import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { Store } from '../storage/store.js';

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-health-'));
  store = await Store.open(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/health/connectivity', () => {
  it('returns 200 + ok when the provider is reachable', async () => {
    const provider = new FakeProvider({
      connectivity: { status: 'ok', detail: 'reachable; credentials accepted', ms: 12 },
    });
    const res = await request(createApp(store, provider, undefined)).get('/api/health/connectivity');
    expect(res.status).toEqual(200);
    expect(res.body.status).toEqual('ok');
    expect(res.body.anthropic.status).toEqual('ok');
  });

  it('returns 503 + the system error code when egress is down', async () => {
    const provider = new FakeProvider({
      connectivity: {
        status: 'down',
        detail: 'cannot reach api.anthropic.com (ETIMEDOUT) — pod egress is down or blocked',
        code: 'ETIMEDOUT',
        ms: 5001,
      },
    });
    const res = await request(createApp(store, provider, undefined)).get('/api/health/connectivity');
    expect(res.status).toEqual(503);
    expect(res.body.status).toEqual('degraded');
    expect(res.body.anthropic.status).toEqual('down');
    expect(res.body.anthropic.code).toEqual('ETIMEDOUT');
    expect(res.body.anthropic.detail).toContain('ETIMEDOUT');
  });

  it('returns 503 + auth when the key is rejected', async () => {
    const provider = new FakeProvider({
      connectivity: { status: 'auth', detail: 'reachable, but the API key was rejected (401)', httpStatus: 401, ms: 80 },
    });
    const res = await request(createApp(store, provider, undefined)).get('/api/health/connectivity');
    expect(res.status).toEqual(503);
    expect(res.body.anthropic.status).toEqual('auth');
    expect(res.body.anthropic.httpStatus).toEqual(401);
  });

  it('needs no customer identity (probe is unauthenticated)', async () => {
    // No x-customer header, no resolveCustomer in the way — a bare probe must still answer.
    const res = await request(createApp(store, new FakeProvider(), undefined)).get('/api/health/connectivity');
    expect(res.status).toEqual(200);
  });
});
