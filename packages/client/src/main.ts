const statusEl = document.getElementById('status');

async function checkHealth(): Promise<void> {
  if (!statusEl) return;
  try {
    const res = await fetch('/api/health');
    const body = (await res.json()) as { status: string };
    statusEl.textContent = body.status;
  } catch (err) {
    statusEl.textContent = `error: ${(err as Error).message}`;
  }
}

void checkHealth();
