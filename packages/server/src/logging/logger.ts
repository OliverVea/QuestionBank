/**
 * Tiny structured console logger. No dependency — just ANSI colors, levels, and a
 * consistent shape so request logs, errors, and LLM timings all read the same way.
 *
 * Levels gate on QB_LOG_LEVEL (debug|info|warn|error), default "info". Set
 * QB_LOG_LEVEL=debug to see LLM request/response bodies and timings.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m', // grey
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function activeLevel(): LogLevel {
  const raw = (process.env.QB_LOG_LEVEL ?? 'info').toLowerCase();
  return raw in LEVEL_ORDER ? (raw as LogLevel) : 'info';
}

function enabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[activeLevel()];
}

function timestamp(): string {
  // HH:MM:SS.mmm — local time, enough to correlate with the client without date noise.
  return new Date().toISOString().slice(11, 23);
}

/** Render a context object as ` key=value key2=value2`, skipping undefined. */
function fmtContext(context?: Record<string, unknown>): string {
  if (!context) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    parts.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return parts.length > 0 ? ` ${DIM}${parts.join(' ')}${RESET}` : '';
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!enabled(level)) return;
  const color = COLORS[level];
  const tag = `${color}${level.toUpperCase().padEnd(5)}${RESET}`;
  const line = `${DIM}${timestamp()}${RESET} ${tag} ${message}${fmtContext(context)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};

/** Pull a human-readable message + stack out of an unknown thrown value. */
export function describeError(err: unknown): { message: string; stack?: string; cause?: string } {
  if (err instanceof Error) {
    const out: { message: string; stack?: string; cause?: string } = { message: err.message };
    if (err.stack) out.stack = err.stack;
    if (err.cause !== undefined) out.cause = describeError(err.cause).message;
    return out;
  }
  return { message: String(err) };
}
