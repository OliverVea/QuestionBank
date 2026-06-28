import { afterEach, describe, expect, test } from 'vitest';
import {
  clearTokens, loadFlow, loadTokens, saveFlow, saveTokens, takeFlow,
} from '@/lib/auth/storage';

afterEach(() => sessionStorage.clear());

describe('token storage', () => {
  test('round-trips a token set', () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 123 };
    saveTokens(tokens);
    expect(loadTokens()).toEqual(tokens);
  });

  test('clearTokens removes them', () => {
    saveTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    clearTokens();
    expect(loadTokens()).toBeNull();
  });

  test('loadTokens returns null when absent', () => {
    expect(loadTokens()).toBeNull();
  });
});

describe('flow storage (PKCE + return-to)', () => {
  test('saveFlow / loadFlow round-trips', () => {
    saveFlow({ verifier: 'v', state: 's', returnTo: '/x' });
    expect(loadFlow()).toEqual({ verifier: 'v', state: 's', returnTo: '/x' });
  });

  test('takeFlow returns then clears', () => {
    saveFlow({ verifier: 'v', state: 's', returnTo: '/x' });
    expect(takeFlow()?.state).toBe('s');
    expect(loadFlow()).toBeNull();
  });
});
