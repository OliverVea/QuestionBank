import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { EnvName, OidcDiscovery } from '@qb/auth-config';
import { authConfig, type CliAuthConfig } from './config.js';
import { discover } from './discovery.js';
import { challengeFromVerifier, generateState, generateVerifier } from './pkce.js';
import { clearTokens, loadTokens, saveTokens, type TokenSet } from './storage.js';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Discovery plus the device endpoint (not in the shared @qb/auth-config shape). */
interface Discovery extends OidcDiscovery {
  device_authorization_endpoint?: string;
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

/** Refresh this many ms before expiry to avoid racing the clock. */
const EXPIRY_SKEW_MS = 30_000;

interface AuthorizeParams {
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

function storeFromResponse(cfg: CliAuthConfig, tokenEndpoint: string, json: TokenResponse): TokenSet {
  const tokens: TokenSet = {
    env: cfg.env,
    authority: cfg.authority,
    clientId: cfg.clientId,
    tokenEndpoint,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

/** Best-effort open of the system browser. Failure is non-fatal — the URL is printed too. */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* user falls back to the printed URL */
  }
}

function resultPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>QuestionBank CLI</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
<h1>QuestionBank CLI</h1><p>${message}</p></body>`;
}

interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

/**
 * Run the loopback half of auth-code + PKCE. Binds a free loopback port (listen on 0 — no fixed
 * port to collide with), opens the browser, and resolves with the code plus the redirect_uri that
 * was actually used (the token exchange must echo it back).
 */
function runLoopback(
  authorizationEndpoint: string,
  cfg: CliAuthConfig,
  pkce: PkcePair,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = '';
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const finish = (html: string) => {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        server.close();
      };
      if (error) {
        finish(resultPage(`Login failed: ${error}. You can close this tab.`));
        reject(new Error(`authorization error: ${error}`));
        return;
      }
      if (!code || state !== pkce.state) {
        finish(resultPage('Login failed: state mismatch. You can close this tab.'));
        reject(new Error('callback state mismatch'));
        return;
      }
      finish(resultPage('Login complete — you can close this tab and return to the terminal.'));
      resolve({ code, redirectUri });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authorizeUrl = buildAuthorizeUrl(authorizationEndpoint, {
        clientId: cfg.clientId,
        redirectUri,
        scopes: cfg.scopes,
        state: pkce.state,
        challenge: pkce.challenge,
      });
      process.stderr.write("Opening your browser to log in. If it doesn't open, visit:\n\n");
      process.stderr.write(`  ${authorizeUrl}\n\n`);
      openBrowser(authorizeUrl);
      process.stderr.write('Waiting for the authentication redirect…\n');
    });
  });
}

async function exchangeCode(
  cfg: CliAuthConfig,
  tokenEndpoint: string,
  redirectUri: string,
  p: { code: string; verifier: string },
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    code_verifier: p.verifier,
  });
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return storeFromResponse(cfg, tokenEndpoint, (await res.json()) as TokenResponse);
}

/** Browser flow: discover, run the loopback PKCE flow, persist tokens. */
async function loginBrowser(cfg: CliAuthConfig, doc: Discovery): Promise<TokenSet> {
  const verifier = generateVerifier();
  const state = generateState();
  const challenge = challengeFromVerifier(verifier);
  const { code, redirectUri } = await runLoopback(doc.authorization_endpoint, cfg, { verifier, challenge, state });
  return exchangeCode(cfg, doc.token_endpoint, redirectUri, { code, verifier });
}

/** Request a device + user code from the device-authorization endpoint (RFC 8628). */
async function startDeviceAuth(endpoint: string, cfg: CliAuthConfig): Promise<DeviceAuthResponse> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, scope: cfg.scopes }),
  });
  if (!res.ok) throw new Error(`device authorization failed: ${res.status} ${await res.text()}`);
  const device = (await res.json()) as DeviceAuthResponse;
  if (!device.device_code || !device.user_code) throw new Error('device authorization response missing device_code/user_code');
  return device;
}

/**
 * Poll the token endpoint until the user approves the device code, honouring `authorization_pending`
 * (keep waiting) and `slow_down` (back off). Gives up once the code expires.
 */
async function pollDeviceToken(cfg: CliAuthConfig, tokenEndpoint: string, device: DeviceAuthResponse): Promise<TokenSet> {
  let intervalMs = Math.max(1, device.interval ?? 5) * 1000;
  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await delay(intervalMs);
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: device.device_code,
        client_id: cfg.clientId,
      }),
    });
    const json = (await res.json()) as TokenResponse & { error?: string };
    if (res.ok) return storeFromResponse(cfg, tokenEndpoint, json);
    if (json.error === 'authorization_pending') continue;
    if (json.error === 'slow_down') {
      intervalMs += 5_000;
      continue;
    }
    throw new Error(`device login failed: ${json.error ?? res.status}`);
  }
  throw new Error('device code expired before approval — run `qb login` again');
}

/** Device flow: show a short code + URL, poll until approved. No local browser/port needed. */
async function loginDevice(cfg: CliAuthConfig, doc: Discovery): Promise<TokenSet> {
  if (!doc.device_authorization_endpoint) {
    throw new Error('this OIDC provider does not advertise a device-authorization endpoint — try `qb login --browser`');
  }
  const device = await startDeviceAuth(doc.device_authorization_endpoint, cfg);
  process.stderr.write('\nTo log in, open this URL and enter the code:\n\n');
  process.stderr.write(`  URL:  ${device.verification_uri}\n`);
  process.stderr.write(`  Code: ${device.user_code}\n`);
  if (device.verification_uri_complete) {
    process.stderr.write(`\n  (or open directly: ${device.verification_uri_complete})\n`);
  }
  process.stderr.write('\nWaiting for approval…\n');
  return pollDeviceToken(cfg, doc.token_endpoint, device);
}

export interface LoginOptions {
  /** Use the loopback browser flow instead of the default device flow. */
  browser?: boolean;
}

/** Full interactive login. Defaults to the device flow; `--browser` uses the loopback PKCE flow. */
export async function login(env: EnvName = 'prod', opts: LoginOptions = {}): Promise<TokenSet> {
  const cfg = authConfig(env);
  const doc = (await discover(cfg.authority)) as Discovery;
  return opts.browser ? loginBrowser(cfg, doc) : loginDevice(cfg, doc);
}

/** Exchange the stored refresh token for a fresh access token. Returns null if not possible. */
async function refresh(tokens: TokenSet): Promise<string | null> {
  if (!tokens.refreshToken) {
    clearTokens();
    return null;
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: tokens.clientId,
  });
  const res = await fetch(tokens.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const json = (await res.json()) as TokenResponse;
  const next: TokenSet = {
    ...tokens,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  saveTokens(next);
  return next.accessToken;
}

/** A valid access token, refreshing if expired. Null if the user must log in again. */
export async function getAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) return tokens.accessToken;
  return refresh(tokens);
}
