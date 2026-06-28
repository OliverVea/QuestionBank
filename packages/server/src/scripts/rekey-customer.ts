import { cp, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Collections to re-key. `remapId` is true only for settings (id === customerId). */
const COLLECTIONS = [
  { file: 'books.json', remapId: false },
  { file: 'questions.json', remapId: false },
  { file: 'attempts.json', remapId: false },
  { file: 'skips.json', remapId: false },
  { file: 'figures.json', remapId: false },
  { file: 'settings.json', remapId: true },
] as const;

type CollectionName =
  'books' | 'questions' | 'attempts' | 'skips' | 'figures' | 'settings';

export interface RekeyOptions {
  dataDir: string;
  oldId: string;
  newId: string;
  /** When true, compute counts but write nothing. */
  dryRun?: boolean;
}

export interface RekeySummary {
  changed: Record<CollectionName, number>;
}

interface Row {
  id: string;
  customerId: string;
  [k: string]: unknown;
}

/**
 * Re-key one tenant's rows from `oldId` to `newId` across every collection, in place. Edits the
 * raw JSON arrays (never deletes), so figure blobs keyed by figure id are untouched. Idempotent:
 * a row already owned by `newId` is left alone, so a re-run changes nothing.
 */
export async function rekeyCustomer(opts: RekeyOptions): Promise<RekeySummary> {
  const changed = {} as Record<CollectionName, number>;
  for (const { file, remapId } of COLLECTIONS) {
    const name = file.replace('.json', '') as CollectionName;
    const path = join(opts.dataDir, file);
    if (!existsSync(path)) {
      changed[name] = 0;
      continue;
    }
    const rows = JSON.parse(await readFile(path, 'utf8')) as Row[];
    if (remapId) {
      const hasOld = rows.some((r) => r.customerId === opts.oldId);
      const hasNew = rows.some((r) => r.id === opts.newId);
      if (hasOld && hasNew) {
        throw new Error(
          `${file}: a row with id "${opts.newId}" already exists; re-keying "${opts.oldId}" ` +
            `would create a duplicate. Resolve the existing ${file} row before migrating.`,
        );
      }
    }
    let count = 0;
    for (const row of rows) {
      if (row.customerId === opts.oldId) {
        row.customerId = opts.newId;
        if (remapId) row.id = opts.newId;
        count++;
      }
    }
    changed[name] = count;
    if (!opts.dryRun && count > 0) {
      // Match JsonCollection's on-disk format (2-space pretty print).
      // Atomic write: write to a temp file then rename to avoid partial-write corruption.
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
      await rename(tmp, path);
    }
  }
  return { changed };
}

/** Recursively copy the data dir to a timestamped sibling. Returns the backup path. */
export async function backupDataDir(dataDir: string, stampIso: string): Promise<string> {
  const stamp = stampIso.replace(/[:.]/g, '-');
  const dest = `${dataDir}.backup-${stamp}`;
  await cp(dataDir, dest, { recursive: true });
  return dest;
}

// ---- CLI -------------------------------------------------------------------
// Usage:
//   QB_DATA_DIR=/data \
//   npx tsx packages/server/src/scripts/rekey-customer.ts --old <OLD_ID> --new <NEW_SUB> [--dry-run]
function parseArgs(argv: string[]): { oldId: string | undefined; newId: string | undefined; dryRun: boolean } {
  let oldId: string | undefined;
  let newId: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--old') oldId = argv[++i];
    else if (argv[i] === '--new') newId = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
  }
  return { oldId, newId, dryRun };
}

async function main(): Promise<void> {
  const { oldId, newId, dryRun } = parseArgs(process.argv.slice(2));
  const dataDir = process.env.QB_DATA_DIR;
  if (!dataDir || !oldId || !newId) {
    throw new Error('Required: QB_DATA_DIR env, --old <id>, --new <sub>');
  }

  const before = await rekeyCustomer({ dataDir, oldId, newId, dryRun: true });
  console.log('Rows to re-key:', before.changed);

  if (dryRun) {
    console.log('Dry run — no changes written.');
    return;
  }

  const backup = await backupDataDir(dataDir, new Date().toISOString());
  console.log('Backed up data dir to:', backup);

  const result = await rekeyCustomer({ dataDir, oldId, newId });
  console.log('Re-keyed:', result.changed);

  const leftover = await rekeyCustomer({ dataDir, oldId, newId, dryRun: true });
  const ok = Object.values(leftover.changed).every((n) => n === 0);
  console.log(ok ? 'Verified: no rows remain under the old id.' : 'WARNING: rows still under old id!');
  if (!ok) throw new Error('Re-key verification failed — restore from backup.');
}

const isEntry = /rekey-customer\.(ts|js)$/.test(process.argv[1] ?? '');
if (isEntry) {
  void main();
}
