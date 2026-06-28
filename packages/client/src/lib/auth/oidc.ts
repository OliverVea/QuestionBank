import { authConfig } from './config.js';
import { discover } from './discovery.js';
import { challengeFromVerifier, generateState, generateVerifier } from './pkce.js';
import {
  clearTokens, loadTokens, saveFlow, saveTokens, takeFlow, type TokenSet,
} from './storage.js';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Refresh this many ms before expiry to avoid racing the clock. */
const EXPIRY_SKEW_MS = 30_000;

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  challenge: string;
}

/** Build the authorize URL (pure). */
export function buildAuthorizeUrl(endpoint: string, p: AuthorizeParams): string {
  const url = new URL(endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scopes);
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function storeFromResponse(json: TokenResponse): TokenSet {
  const tokens: TokenSet = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

/** Begin auth-code + PKCE: persist the flow, then redirect to Authentik. */
export async function login(returnTo: string = window.location.href): Promise<void> {
  const cfg = authConfig();
  const doc = await discover(cfg.authority);
  const verifier = generateVerifier();
  const state = generateState();
  saveFlow({ verifier, state, returnTo });
  const challenge = await challengeFromVerifier(verifier);
  window.location.assign(
    buildAuthorizeUrl(doc.authorization_endpoint, {
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      scopes: cfg.scopes,
      state,
      challenge,
    }),
  );
}

export interface ExchangeParams {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}

/** Exchange an authorization code for tokens and store them. */
export async function exchangeCode(authority: string, p: ExchangeParams): Promise<TokenSet> {
  const doc = await discover(authority);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.verifier,
  });
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return storeFromResponse((await res.json()) as TokenResponse);
}

/**
 * Handle the redirect back from Authentik: validate state, exchange the code, then return the
 * location to resume. Throws on state mismatch or a missing flow.
 */
export async function handleCallback(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const flow = takeFlow();
  if (!flow) throw new Error('no auth flow in progress');
  if (!code || state !== flow.state) throw new Error('auth callback state mismatch');
  const cfg = authConfig();
  await exchangeCode(cfg.authority, {
    code,
    verifier: flow.verifier,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
  });
  return flow.returnTo;
}

/** Exchange the stored refresh token for a fresh access token. Returns null if not possible. */
export async function refresh(authority: string, clientId: string): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens?.refreshToken) return null;
  const doc = await discover(authority);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  return storeFromResponse((await res.json()) as TokenResponse).accessToken;
}

/** A valid access token, refreshing if expired. Null if the user must log in again. */
export async function getAccessToken(
  authority: string = authConfig().authority,
  clientId: string = authConfig().clientId,
): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) return tokens.accessToken;
  return refresh(authority, clientId);
}

/** Clear local tokens and redirect to Authentik's end-session endpoint if present. */
export async function logout(): Promise<void> {
  const cfg = authConfig();
  clearTokens();
  const doc = await discover(cfg.authority);
  if (doc.end_session_endpoint) {
    window.location.assign(doc.end_session_endpoint);
  } else {
    window.location.assign('/');
  }
}
