// Build a static report.html comparing model matchers (Opus vs Sonnet) against each
// case's figure-service output. Per figure: each model's printed label + matched
// question + confidence, with disagreements on the matched question flagged.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, 'cases');

// Model result files to overlay, in display order. Add rows here to compare more models.
const MODELS = [
  { key: 'opus', label: 'Opus 4.8', file: 'match.json' },
  { key: 'sonnet', label: 'Sonnet 4.6', file: 'match.sonnet.json' },
  { key: 'haiku', label: 'Haiku 4.5', file: 'match.haiku.json' },
].filter((m) => readdirSync(CASES_DIR).some((c) => existsSync(join(CASES_DIR, c, m.file))));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s ?? '').trim().toLowerCase();

const cases = readdirSync(CASES_DIR).filter((d) => d.startsWith('test_')).sort();
const sections = [];
let agree = 0, disagree = 0, comparable = 0;

for (const c of cases) {
  const dir = join(CASES_DIR, c);
  const meta = JSON.parse(readFileSync(join(dir, 'figures.json'), 'utf8'));

  // Per model: { questions: Map(label->summary), byId: Map(figId->figureResult) }
  const models = MODELS.map((m) => {
    const data = existsSync(join(dir, m.file)) ? JSON.parse(readFileSync(join(dir, m.file), 'utf8')) : null;
    // Support both the verbose schema (page_questions: [{label,summary}]) and the
    // lean schema (question_labels: [string]).
    const questions = data?.page_questions
      ? data.page_questions.map((q) => [q.label, q.summary ?? ''])
      : (data?.question_labels ?? []).map((l) => [l, '']);
    return {
      ...m,
      qs: new Map(questions),
      byId: new Map((data?.figures ?? []).map((f) => [f.figure_id, f])),
      nQ: questions.length,
    };
  });

  const figuresHtml = meta.figures.map((fig) => {
    const verdicts = models.map((m) => m.byId.get(fig.id));
    // disagreement = the present models matched this figure to different questions
    const matched = verdicts.filter(Boolean).map((v) => norm(v.matched_question_label));
    const bothPresent = verdicts.every(Boolean) && models.length > 1;
    let flag = '';
    if (bothPresent) {
      comparable++;
      if (new Set(matched).size === 1) { agree++; flag = '<span class="agree">match</span>'; }
      else { disagree++; flag = '<span class="disagree">differ</span>'; }
    }

    const rows = models.map((m, i) => {
      const v = verdicts[i];
      if (!v) return `<div class="mrow"><span class="mname">${esc(m.label)}</span><span class="missing">—</span></div>`;
      const conf = v.confidence ?? 'n/a';
      const label = v.printed_label ? `“${esc(v.printed_label)}”` : '<i>no label</i>';
      const match = v.matched_question_label
        ? `→ <b>${esc(v.matched_question_label)}</b> <span class="qs">${esc(m.qs.get(v.matched_question_label) ?? '')}</span>`
        : '→ <span class="unmatched">unmatched</span>';
      return `<div class="mrow">
        <span class="mname">${esc(m.label)} <span class="badge ${esc(conf)}">${esc(conf)}</span></span>
        <span class="mbody">${label} ${match}<div class="reason">${esc(v.reasoning ?? '')}</div></span>
      </div>`;
    }).join('');

    return `<div class="fig ${bothPresent ? (new Set(matched).size === 1 ? 'ok' : 'bad') : ''}">
      <img src="cases/${esc(c)}/${esc(fig.crop)}" loading="lazy" alt="figure ${fig.id}">
      <div class="figmeta">
        <div class="figid">figure_${fig.id} <span class="score">det ${esc(fig.score)}</span> ${flag}</div>
        ${rows}
      </div>
    </div>`;
  }).join('');

  const qCounts = models.map((m) => `${esc(m.label)}: ${m.nQ}`).join(' · ');
  sections.push(`<section>
    <h2>${esc(c)} <span class="src">${esc(meta.source)}</span></h2>
    <div class="case">
      <div class="pagecol">
        <a href="cases/${esc(c)}/rectified.jpg" target="_blank"><img class="page" src="cases/${esc(c)}/rectified.jpg" loading="lazy" alt="page ${esc(c)}"></a>
        <div class="qcount">questions found — ${qCounts}</div>
      </div>
      <div class="figcol">${figuresHtml}</div>
    </div>
  </section>`);
}

const modelNames = MODELS.map((m) => m.label).join(', ');
const summary = MODELS.length > 1 && comparable
  ? `<p class="lede">${modelNames}: all agreed on the matched question for <b>${agree}/${comparable}</b> figures (${disagree} differ). Disagreements are outlined red.</p>`
  : `<p class="lede">claude models over the deployed figure-service output. Click a page to enlarge.</p>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Figure → question matching</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.45 system-ui, sans-serif; margin: 0; padding: 1.5rem; max-width: 1500px; }
  h1 { margin: 0 0 .25rem; } .lede { color: #888; margin: 0 0 1.5rem; }
  section { border-top: 2px solid #8884; padding: 1rem 0 2rem; }
  h2 { margin: .2rem 0 1rem; } h2 .src { font-weight: 400; color: #888; font-size: .8em; }
  .case { display: grid; grid-template-columns: minmax(260px, 380px) 1fr; gap: 1.5rem; align-items: start; }
  .page { width: 100%; border: 1px solid #8884; border-radius: 6px; }
  .qcount { color: #888; font-size: .85em; margin-top: .5rem; }
  .figcol { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: .75rem; }
  .fig { display: flex; gap: .6rem; border: 1px solid #8884; border-radius: 6px; padding: .5rem; }
  .fig.ok { border-left: 4px solid #3a7; } .fig.bad { border-left: 4px solid #d44; }
  .fig img { width: 88px; height: 88px; object-fit: contain; background: #8881; border-radius: 4px; flex: none; }
  .figmeta { min-width: 0; flex: 1; } .figid { font-weight: 600; margin-bottom: .25rem; } .figid .score { color: #999; font-weight: 400; font-size: .8em; }
  .mrow { display: grid; grid-template-columns: 110px 1fr; gap: .5rem; padding: .2rem 0; border-top: 1px solid #8882; }
  .mname { color: #aaa; font-size: .85em; } .mbody { min-width: 0; }
  .badge { font-size: .72em; padding: .05em .4em; border-radius: 4px; }
  .badge.high { background: #3a72; color: #3a7; } .badge.medium { background: #db42; color: #c93; } .badge.low { background: #d442; color: #d44; }
  .qs { color: #999; font-size: .85em; } .reason { color: #999; font-size: .82em; margin-top: .1rem; }
  .unmatched, .missing { color: #d44; }
  .agree { color: #3a7; font-size: .75em; border: 1px solid #3a7; padding: 0 .35em; border-radius: 4px; }
  .disagree { color: #d44; font-size: .75em; border: 1px solid #d44; padding: 0 .35em; border-radius: 4px; }
</style></head><body>
<h1>Figure → question matching</h1>
${summary}
${sections.join('\n')}
</body></html>`;

writeFileSync(join(HERE, 'report.html'), html);
console.log(`wrote report.html (${cases.length} cases, models: ${MODELS.map((m) => m.key).join(', ') || 'none'})`);
