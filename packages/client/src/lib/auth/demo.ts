const GUEST_KEY = 'qb.demo.guest';

let guestToken: string | null = null;

/** The guest bearer token while the app runs against the public demo, else null. */
export function demoToken(): string | null {
  return guestToken;
}

/**
 * Ask the server whether this is the public demo (its health check says so). If it is,
 * adopt a guest identity instead of logging in: a random id kept in localStorage, which
 * the server turns into a private tenant seeded with the sample library.
 */
export async function detectDemo(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    const body = (await res.json()) as { mode?: string };
    if (body.mode !== 'demo') return false;
  } catch {
    return false;
  }
  let id = localStorage.getItem(GUEST_KEY);
  if (id === null) {
    id = crypto.randomUUID();
    localStorage.setItem(GUEST_KEY, id);
  }
  guestToken = `demo-${id}`;
  return true;
}
