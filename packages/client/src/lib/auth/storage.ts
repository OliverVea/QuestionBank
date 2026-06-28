const TOKENS_KEY = 'qb.auth.tokens';
const FLOW_KEY = 'qb.auth.flow';

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute expiry in epoch milliseconds. */
  expiresAt: number;
}

/** Transient state persisted across the authorize redirect. */
export interface AuthFlow {
  verifier: string;
  state: string;
  returnTo: string;
}

export function saveTokens(tokens: TokenSet): void {
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function loadTokens(): TokenSet | null {
  const raw = sessionStorage.getItem(TOKENS_KEY);
  return raw ? (JSON.parse(raw) as TokenSet) : null;
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKENS_KEY);
}

export function saveFlow(flow: AuthFlow): void {
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
}

export function loadFlow(): AuthFlow | null {
  const raw = sessionStorage.getItem(FLOW_KEY);
  return raw ? (JSON.parse(raw) as AuthFlow) : null;
}

/** Read and remove the flow (single-use after callback). */
export function takeFlow(): AuthFlow | null {
  const flow = loadFlow();
  sessionStorage.removeItem(FLOW_KEY);
  return flow;
}
