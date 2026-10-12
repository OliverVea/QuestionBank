import { demoToken } from '@/lib/auth';

/** True while the app runs against the public demo (guest mode, recorded model results). */
export function isDemo(): boolean {
  return demoToken() !== null;
}

/** Sample handwritten answers the demo can replay, by "<book title> · <label>". */
const SAMPLE_ANSWERS: Record<string, string> = {
  'Forces and Motion · 4.1.2': '/demo/answer-4-1-2.jpg',
};

/** URL of the sample answer photo for this problem, if the demo has one. */
export function sampleAnswerUrl(bookTitle: string, label: string): string | null {
  if (!isDemo()) return null;
  return SAMPLE_ANSWERS[`${bookTitle} · ${label}`] ?? null;
}

/** Load a sample as a File with its original bytes, so it goes through the normal upload. */
export async function sampleFile(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sample not found: ${url}`);
  const name = url.slice(url.lastIndexOf('/') + 1);
  return new File([await res.blob()], name, { type: 'image/jpeg' });
}

/** What to say when the demo has no recorded result for what the visitor just tried. */
export const DEMO_NO_RECORDING =
  'The demo only replays recorded results. Try the sample: the next problem in Forces and Motion (4.1.2), then "Use the sample handwritten answer".';
