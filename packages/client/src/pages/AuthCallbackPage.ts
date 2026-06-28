import { html } from '@/lib/html';

/** Minimal "signing in" view shown while the callback exchange runs. */
export function AuthCallbackPage(): HTMLElement {
  return html`<main class="auth-callback"><p>Signing you in…</p></main>`;
}
