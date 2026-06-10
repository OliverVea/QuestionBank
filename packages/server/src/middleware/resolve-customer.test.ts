import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { ImageStore } from '../storage/images.js';
import { Store } from '../storage/store.js';
import { configFromEnv, type ResolveCustomerConfig } from './resolve-customer.js';

let dir: string;

async function appWith(config: ResolveCustomerConfig) {
  dir = await mkdtemp(join(tmpdir(), 'qb-resolve-'));
  const store = await Store.open(dir);
  return createApp(store, new FakeProvider(), new ImageStore(dir), config);
}

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const STRICT: ResolveCustomerConfig = {
  customerHeader: 'X-Customer-Id',
  allowDefaultCustomer: false,
  proxySecretHeader: 'X-Proxy-Secret',
};

describe('resolveCustomer middleware', () => {
  it('401s an unattributed request when the default customer is off', async () => {
    const app = await appWith(STRICT);
    const res = await request(app).get('/api/books');
    expect(res.status).toEqual(401);
  });

  it('resolves an identity header to that customer', async () => {
    const app = await appWith(STRICT);
    const created = await request(app)
      .post('/api/books')
      .set('X-Customer-Id', 'alice')
      .send({ title: 'A' });
    expect(created.status).toEqual(201);
    // The book is visible to alice and to no one else.
    const alice = await request(app).get('/api/books').set('X-Customer-Id', 'alice');
    expect(alice.body).toHaveLength(1);
    const bob = await request(app).get('/api/books').set('X-Customer-Id', 'bob');
    expect(bob.body).toEqual([]);
  });

  it('falls back to "local" when the default customer is on', async () => {
    const app = await appWith({ ...STRICT, allowDefaultCustomer: true });
    const created = await request(app).post('/api/books').send({ title: 'A' });
    expect(created.status).toEqual(201);
    const list = await request(app).get('/api/books');
    expect(list.body).toHaveLength(1);
  });

  it('uses a custom identity header name when configured', async () => {
    const app = await appWith({ ...STRICT, customerHeader: 'X-authentik-uid' });
    const res = await request(app)
      .post('/api/books')
      .set('X-authentik-uid', 'uid-123')
      .send({ title: 'A' });
    expect(res.status).toEqual(201);
  });

  describe('proxy-secret gate', () => {
    const SECRET_CONFIG: ResolveCustomerConfig = {
      ...STRICT,
      allowDefaultCustomer: true,
      trustedProxySecret: 's3cret',
    };

    it('401s when the proxy-secret header is missing', async () => {
      const app = await appWith(SECRET_CONFIG);
      const res = await request(app).get('/api/books');
      expect(res.status).toEqual(401);
    });

    it('401s when the proxy-secret does not match', async () => {
      const app = await appWith(SECRET_CONFIG);
      const res = await request(app).get('/api/books').set('X-Proxy-Secret', 'wrong');
      expect(res.status).toEqual(401);
    });

    it('passes when the proxy-secret matches (and then resolves the customer)', async () => {
      const app = await appWith(SECRET_CONFIG);
      const res = await request(app).get('/api/books').set('X-Proxy-Secret', 's3cret');
      expect(res.status).toEqual(200);
    });

    it('still 401s a bad identity path even with a valid proxy-secret (secret is not identity)', async () => {
      const app = await appWith({ ...SECRET_CONFIG, allowDefaultCustomer: false });
      // Valid proxy-secret but no identity header and no default → still unauthorized.
      const res = await request(app).get('/api/books').set('X-Proxy-Secret', 's3cret');
      expect(res.status).toEqual(401);
    });
  });

  it('health stays open (no identity required)', async () => {
    const app = await appWith(STRICT);
    const res = await request(app).get('/api/health');
    expect(res.status).toEqual(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('configFromEnv', () => {
  it('is strict by default (no default customer, no proxy gate)', () => {
    const cfg = configFromEnv({});
    expect(cfg.customerHeader).toEqual('X-Customer-Id');
    expect(cfg.allowDefaultCustomer).toBe(false);
    expect(cfg.trustedProxySecret).toBeUndefined();
    expect(cfg.proxySecretHeader).toEqual('X-Proxy-Secret');
  });

  it('reads overrides and truthy default flag from env', () => {
    const cfg = configFromEnv({
      QB_CUSTOMER_HEADER: 'X-authentik-uid',
      QB_ALLOW_DEFAULT_CUSTOMER: 'true',
      QB_TRUSTED_PROXY_SECRET: 'abc',
      QB_PROXY_SECRET_HEADER: 'X-Secret',
    });
    expect(cfg.customerHeader).toEqual('X-authentik-uid');
    expect(cfg.allowDefaultCustomer).toBe(true);
    expect(cfg.trustedProxySecret).toEqual('abc');
    expect(cfg.proxySecretHeader).toEqual('X-Secret');
  });
});
