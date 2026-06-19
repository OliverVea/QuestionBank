// packages/client/src/pages/grade/GraderBubble.ts
import { ChatBubble } from '@/components/ChatBubble';
import { renderLatex } from '@/lib/latex';
import type { GradePayload } from './conversation';

/** Grader payload → bubble DOM (badge / issues / collapsible reasoning). */
export function GraderBubble(p: GradePayload): HTMLElement {
  const el = ChatBubble('agent');

  const badge = document.createElement('span');
  badge.className = `grade-badge grade-${p.recommendedGrade}`;
  badge.textContent = p.recommendedGrade;
  el.appendChild(badge);

  if (p.issues.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'grade-ok';
    ok.textContent = 'No issues found — looks correct.';
    el.appendChild(ok);
  } else {
    const list = document.createElement('ul');
    list.className = 'issue-list';
    for (const issue of p.issues) {
      const li = document.createElement('li');
      li.className = `issue issue-${issue.severity}`;
      const sev = document.createElement('span');
      sev.className = 'issue-sev';
      sev.textContent = issue.severity;
      const desc = document.createElement('span');
      desc.className = 'issue-desc';
      renderLatex(desc, issue.description, '');
      li.append(sev, desc);
      list.appendChild(li);
    }
    el.appendChild(list);
  }

  const det = document.createElement('details');
  det.className = 'reasoning';
  const sum = document.createElement('summary');
  sum.textContent = 'Show reasoning';
  const rb = document.createElement('div');
  rb.className = 'reasoning-body';
  renderLatex(rb, p.reasoning, '');
  det.append(sum, rb);
  el.appendChild(det);

  return el;
}
