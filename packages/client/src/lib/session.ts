/**
 * Session looping state — an in-memory, client-only singleton that gives the
 * Learn and Practice loops a sense of a "session": a running count of completed
 * items per mode, plus the rule for when to show the celebratory pause checkpoint.
 *
 * Deliberately NOT persisted: a full reload / PWA relaunch clears it. Counts are
 * independent per mode. See docs/superpowers/specs/2026-06-17-session-looping-design.md.
 */
export type SessionMode = 'learn' | 'revisit';

interface ModeSession {
  count: number;
  /** Chapter of the most recently completed learn item; null for revisit / fresh. */
  lastChapter: string | null;
}

const sessions: Record<SessionMode, ModeSession> = {
  learn: { count: 0, lastChapter: null },
  revisit: { count: 0, lastChapter: null },
};

/**
 * Record one completed item. For `learn`, pass the completed item's chapter so the
 * next load can detect a chapter seam; for `revisit` the chapter is ignored.
 */
export function recordCompleted(mode: SessionMode, chapter: string | null = null): void {
  const s = sessions[mode];
  s.count += 1;
  if (mode === 'learn') s.lastChapter = chapter;
}

/** The running count of completed items for a mode. */
export function getCount(mode: SessionMode): number {
  return sessions[mode].count;
}

/** The chapter of the most recently completed item (learn only; null otherwise). */
export function getLastChapter(mode: SessionMode): string | null {
  return sessions[mode].lastChapter;
}

export interface ShouldPauseOpts {
  /** The incoming next item's chapter (learn seam detection). */
  nextChapter?: string | null;
  /** The Practice pause cadence (revisit every-N detection). Defaults to 10. */
  pauseEvery?: number;
}

/**
 * Whether to show the pause checkpoint BEFORE rendering the next item.
 *  - learn: a previous item exists AND the next item's chapter differs from the
 *    last completed chapter (the seam).
 *  - revisit: count > 0 and count is a multiple of pauseEvery.
 */
export function shouldPause(mode: SessionMode, opts: ShouldPauseOpts = {}): boolean {
  const s = sessions[mode];
  if (mode === 'learn') {
    if (s.lastChapter === null) return false; // no previous completion yet
    return (opts.nextChapter ?? null) !== s.lastChapter;
  }
  const every = opts.pauseEvery ?? 10;
  return s.count > 0 && s.count % every === 0;
}

/** End the session for a mode — zero the count and clear lastChapter. */
export function reset(mode: SessionMode): void {
  sessions[mode] = { count: 0, lastChapter: null };
}
