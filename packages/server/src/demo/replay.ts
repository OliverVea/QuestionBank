import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LlmError } from '../llm/provider.js';
import type { CompleteOpts, ConnectivityResult, LlmProvider, Message } from '../llm/provider.js';
import { log } from '../logging/logger.js';

/** Recorded model results for the demo's sample inputs: `packages/server/demo/recordings.json`. */
export const DEMO_RECORDINGS_FILE = fileURLToPath(new URL('../../demo/recordings.json', import.meta.url));

/** One recorded structured result, found again by the hash of the request that produced it. */
export interface Recording {
  tag: string;
  key: string;
  result: unknown;
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/**
 * Identity of a model request: its tag, and each turn's role, text and image bytes. The same
 * sample photo and the same prompt always give the same key; anything else gives another.
 */
export async function requestKey(tag: string, conversation: Message[]): Promise<string> {
  const turns = await Promise.all(
    conversation.map(async (m) => ({
      role: m.role,
      text: m.text,
      images: await Promise.all((m.images ?? []).map(async (image) => sha256(await image.load()))),
    })),
  );
  return sha256(JSON.stringify([tag, turns]));
}

export async function loadRecordings(file: string = DEMO_RECORDINGS_FILE): Promise<Recording[]> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Recording[];
  } catch {
    return [];
  }
}

/**
 * The demo's model backend: it replays what the real model answered for the sample inputs,
 * and has nothing else. The demo pod holds no API key, so nothing a visitor does can bill;
 * a request that was never recorded fails like any other backend error.
 */
export class ReplayProvider implements LlmProvider {
  private readonly byKey: Map<string, unknown>;

  constructor(recordings: Recording[]) {
    this.byKey = new Map(recordings.map((r) => [r.key, r.result]));
  }

  async complete(_conversation: Message[], _opts?: CompleteOpts): Promise<string> {
    throw new LlmError('the demo has no recording for this request');
  }

  async completeStructured<T>(conversation: Message[], _schema: object, opts?: CompleteOpts): Promise<T> {
    const tag = opts?.tag ?? '';
    const result = this.byKey.get(await requestKey(tag, conversation));
    if (result === undefined) {
      log.info('demo replay miss', { tag });
      throw new LlmError('the demo has no recording for this request');
    }
    return structuredClone(result) as T;
  }

  async checkConnectivity(): Promise<ConnectivityResult> {
    return { status: 'ok', detail: 'demo mode: recorded results only', ms: 0 };
  }
}

/**
 * Wraps a real provider and saves every structured result to `file`. Used once, locally, to
 * make the recordings the demo replays (QB_DEMO_RECORD=1); never part of a deployment.
 */
export class RecordingProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly file: string = DEMO_RECORDINGS_FILE,
  ) {}

  complete(conversation: Message[], opts?: CompleteOpts): Promise<string> {
    return this.inner.complete(conversation, opts);
  }

  async completeStructured<T>(conversation: Message[], schema: object, opts?: CompleteOpts): Promise<T> {
    const result = await this.inner.completeStructured<T>(conversation, schema, opts);
    const tag = opts?.tag ?? '';
    const key = await requestKey(tag, conversation);
    const recordings = (await loadRecordings(this.file)).filter((r) => r.key !== key);
    recordings.push({ tag, key, result });
    await writeFile(this.file, `${JSON.stringify(recordings, null, 2)}\n`);
    log.info('demo recording saved', { tag, recordings: recordings.length });
    return result;
  }

  checkConnectivity(): Promise<ConnectivityResult> {
    return this.inner.checkConnectivity();
  }
}
