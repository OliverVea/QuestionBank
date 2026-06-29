#!/usr/bin/env node
import type { EnvName } from '@qb/auth-config';
import { getBooks } from './api.js';
import { login } from './auth/oidc.js';
import { clearTokens, loadTokens, tokenStorePath } from './auth/storage.js';

const USAGE = `qb — QuestionBank CLI

Usage:
  qb login [--env prod|beta] [--browser]
                               Log in (device flow by default; --browser uses a
                               loopback redirect). Opens/points you at Authentik.
  qb books                     List your books
  qb logout                    Forget the cached token
  qb help                      Show this help

Default env is prod. Tokens are cached at ${tokenStorePath()} (0600).`;

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/** Parse `--env prod|beta` from args, defaulting to prod. */
function parseEnv(args: string[]): EnvName {
  const i = args.indexOf('--env');
  if (i === -1) return 'prod';
  const value = args[i + 1];
  if (value === 'prod' || value === 'beta') return value;
  fail(`--env expects 'prod' or 'beta', got '${value ?? ''}'`);
}

async function cmdLogin(args: string[]): Promise<void> {
  const env = parseEnv(args);
  await login(env, { browser: args.includes('--browser') });
  process.stdout.write(`Logged in to ${env}. Token cached at ${tokenStorePath()}.\n`);
}

async function cmdBooks(): Promise<void> {
  const books = await getBooks();
  if (books.length === 0) {
    process.stdout.write('No books yet.\n');
    return;
  }
  for (const book of books) {
    const author = book.author ? ` — ${book.author}` : '';
    process.stdout.write(`${book.title}${author}  (${book.id})\n`);
  }
}

function cmdLogout(): void {
  const had = loadTokens() !== null;
  clearTokens();
  process.stdout.write(had ? 'Logged out.\n' : 'Already logged out.\n');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'login':
      return cmdLogin(rest);
    case 'books':
      return cmdBooks();
    case 'logout':
      return cmdLogout();
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${USAGE}\n`);
      return;
    default:
      fail(`unknown command '${command}'\n\n${USAGE}`);
  }
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
