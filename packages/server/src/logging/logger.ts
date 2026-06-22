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

type LogFormat = 'pretty' | 'json';

function activeFormat(): LogFormat {
  return (process.env.QB_LOG_FORMAT ?? '').toLowerCase() === 'json' ? 'json' : 'pretty';
}

function timestamp(): string {
  // HH:MM:SS.mmm — UTC, enough to correlate with the client without date noise.
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

const RESERVED_JSON_KEYS = new Set(['ts', 'level', 'msg']);

/** One JSON object per line: { ts, level, msg, ...context }. No ANSI. */
function renderJson(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined || RESERVED_JSON_KEYS.has(key)) continue;
      record[key] = value;
    }
  }
  try {
    return JSON.stringify(record);
  } catch {
    // Context held an un-serializable value (circular ref, BigInt). Never let a log
    // call throw — emit a minimal record that always serializes.
    return JSON.stringify({ ts: record.ts, level, msg: message, logError: 'unserializable context' });
  }
}

/** Today's human format: dim timestamp, colored level tag, dim context. */
function renderPretty(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const color = COLORS[level];
  const tag = `${color}${level.toUpperCase().padEnd(5)}${RESET}`;
  return `${DIM}${timestamp()}${RESET} ${tag} ${message}${fmtContext(context)}`;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!enabled(level)) return;
  const line =
    activeFormat() === 'json'
      ? renderJson(level, message, context)
      : renderPretty(level, message, context);
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

/**
 * Walk the `.cause` chain and return the first system error `code` (e.g. "ETIMEDOUT",
 * "ECONNREFUSED", "ENOTFOUND"). Transport failures surface this code several causes deep —
 * the Anthropic SDK wraps it as APIConnectionError("Connection error.") → TypeError("fetch
 * failed") → { code }. describeError only reads each level's `.message`, so the code is
 * invisible there; this is what turns "request failed" into "request failed: ETIMEDOUT".
 */
export function errorCode(err: unknown): string | undefined {
  let current: unknown = err;
  // Bound the walk so a self-referential cause can't loop forever.
  for (let depth = 0; current != null && depth < 10; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
