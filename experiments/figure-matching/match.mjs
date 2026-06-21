// Figure -> question matcher spike.
//
// Sends Claude Opus 4.8 the rectified page image plus each detected figure crop
// (labelled by id) and asks it to (1) list the problems/questions on the page,
// (2) read each figure's printed label off the page, and (3) match each figure to
// the question it belongs to. Structured output so the result is machine-checkable.
//
// This is an experiment for manual review, NOT app code — it uses the repo's
// installed @anthropic-ai/sdk for convenience. The real matcher would live in
// packages/server.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... node experiments/figure-matching/match.mjs            # all cases
//   ANTHROPIC_API_KEY=sk-... node experiments/figure-matching/match.mjs test_3     # one case
//
// Writes match.json into each case folder and prints a summary for manual review.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, 'cases');
// Default model is Haiku 4.5 — chosen for the figure->question matcher: ~$0.04 per 6
// pages and 41/42 correct on the spike (only missed one faint figure), which leaves
// plenty of budget for testing/tuning. Override to compare other models:
//   MATCH_MODEL=claude-sonnet-4-6 MATCH_OUT=match.sonnet.json node ... match.mjs
const MODEL = process.env.MATCH_MODEL || 'claude-haiku-4-5';
const OUT = process.env.MATCH_OUT || 'match.haiku.json';

// Lean schema: only the fields the pipeline needs. No per-question summaries and no
// per-figure reasoning prose (those dominated output tokens and were display-only).
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['question_labels', 'figures'],
  properties: {
    question_labels: {
      type: 'array',
      description: 'The printed number/label of every problem/question on the page, e.g. "11" or "P5.32".',
      items: { type: 'string' },
    },
    figures: {
      type: 'array',
      description: 'One entry per detected figure id provided, in id order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['figure_id', 'printed_label', 'matched_question_label', 'confidence'],
        properties: {
          figure_id: { type: 'integer' },
          printed_label: { type: 'string', description: 'Caption/label printed on the page for this figure, e.g. "Figure P5.32". Empty string if none is visible.' },
          matched_question_label: { type: 'string', description: 'Which question_labels entry this figure belongs to. Empty string if it cannot be matched.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const PROMPT = `You are matching extracted figures to the problems on a textbook page.

The FIRST image is the full (dewarped) page. The images after it are individual figure
crops detected on that page; each crop is preceded by a line "figure_id: N" giving its id.

Do three things:
1. List the bare printed number/label of every problem/question on the page (e.g. "11"
   or "P5.32") — just the label, nothing else.
2. For each figure id, read its printed reference in COMPACT form: drop the word "FIGURE"
   and keep only the reference, e.g. "Q18.11" or "P5.32". Empty string if no label is visible.
3. Match each figure id to the problem it belongs to. Use caption labels, the figure's
   position relative to a problem, and any reference to the figure in a problem's text.
   If a figure cannot be tied to a specific problem, leave matched_question_label empty.

Return one figures entry for every figure id provided, in id order.`;

function imageBlock(path, mediaType = 'image/jpeg') {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: readFileSync(path).toString('base64') } };
}

async function matchCase(client, caseName) {
  const dir = join(CASES_DIR, caseName);
  const meta = JSON.parse(readFileSync(join(dir, 'figures.json'), 'utf8'));

  const content = [
    { type: 'text', text: PROMPT },
    { type: 'text', text: 'PAGE:' },
    imageBlock(join(dir, 'rectified.jpg')),
  ];
  for (const fig of meta.figures) {
    content.push({ type: 'text', text: `figure_id: ${fig.id}` });
    content.push(imageBlock(join(dir, fig.crop)));
  }

  // Haiku 4.5 rejects the effort parameter and has no adaptive thinking — send a plain
  // structured-output request there. Other models: adaptive thinking + low effort.
  const isHaiku = MODEL.includes('haiku');
  const req = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  };
  if (!isHaiku) {
    req.thinking = { type: 'adaptive' };
    req.output_config.effort = process.env.MATCH_EFFORT || 'low';
  }
  const resp = await client.messages.create(req);

  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const result = JSON.parse(text);
  writeFileSync(join(dir, OUT), JSON.stringify(result, null, 2));

  console.log(`\n===== ${caseName}  (${MODEL}, source: ${meta.source}) =====`);
  console.log(`question labels: ${(result.question_labels ?? []).join(', ')}`);
  for (const f of result.figures) {
    const label = f.printed_label ? `"${f.printed_label}"` : '(no label)';
    const match = f.matched_question_label ? `-> ${f.matched_question_label}` : '-> (unmatched)';
    console.log(`  figure_${f.figure_id} ${label} ${match}  [${f.confidence}]`);
  }
  const u = resp.usage;
  console.log(`  tokens: in=${u.input_tokens} out=${u.output_tokens}`);
  return result;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Run with: ANTHROPIC_API_KEY=sk-... node experiments/figure-matching/match.mjs');
    process.exit(1);
  }
  const client = new Anthropic({ timeout: 180_000 });
  const arg = process.argv[2];
  const cases = arg ? [arg] : readdirSync(CASES_DIR).filter((d) => d.startsWith('test_')).sort();
  for (const c of cases) {
    try {
      await matchCase(client, c);
    } catch (err) {
      console.error(`\n${c}: FAILED — ${err?.message ?? err}`);
    }
  }
}

main();
