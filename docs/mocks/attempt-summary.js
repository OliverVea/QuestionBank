// Shared attempt-summary helpers for the view-book + attempt-history mocks.
//
// A problem's status badge has two independent parts:
//   • mastery word — New / Improving / Strong / Excellent, derived from the
//     grade history (how well the problem is known).
//   • readiness    — ready / waiting / finalized, which drives the badge COLOR
//     (purple = act now, grey = resting, green = graduated). Excellent maps to
//     'finalized'; a brand-new problem is always 'ready'.
//
// And the CI-history strip is just the per-attempt grades in order.
//
// These are mock heuristics over an `attempts` array of { grade, ... } (grade =
// 'correct' | 'partial' | 'incorrect', oldest first). The real client derives
// mastery from grade history and readiness from the scheduler's due date; a
// problem may carry an explicit `status` to pin readiness in the seed data.
//
// Lifted into a shared file (like footer.js) because both screens render the
// exact same badge.

(() => {
  // Weight recent attempts: correct=1, partial=0.5, incorrect=0; average the
  // last few → a mastery word.
  function mastery(problem) {
    const a = problem.attempts || [];
    if (a.length === 0) return 'new';
    const recent = a.slice(-4);
    const score = recent.reduce(
      (s, at) => s + ({ correct: 1, partial: 0.5, incorrect: 0 }[at.grade] ?? 0), 0,
    ) / recent.length;
    if (score >= 0.85) return 'excellent';
    if (score >= 0.6) return 'strong';
    return 'improving';
  }
  const MASTERY_LABEL = { new: 'New', improving: 'Improving', strong: 'Strong', excellent: 'Excellent' };

  // Readiness drives the badge color. Explicit `status` wins (seed data); an
  // Excellent problem is 'finalized' (graduated); a problem with no attempts is
  // always 'ready'; otherwise default to 'waiting' (resting between reviews).
  function readiness(problem, masteryWord) {
    if (problem.status) return problem.status;
    if (masteryWord === 'excellent') return 'finalized';
    if ((problem.attempts || []).length === 0) return 'ready';
    return 'waiting';
  }

  // Build the badge element: <span class="status-badge ready-…">Word</span>.
  function badgeEl(problem) {
    const m = mastery(problem);
    const r = readiness(problem, m);
    const el = document.createElement('span');
    el.className = 'status-badge ready-' + r;
    el.textContent = MASTERY_LABEL[m];
    return el;
  }

  // Build the CI-history strip from the attempts (oldest→newest). `large` uses
  // the bigger tick variant. `cap` limits how many ticks (newest kept).
  function ciStripEl(attempts, { large = false, cap = 0 } = {}) {
    const strip = document.createElement('span');
    strip.className = 'ci-strip' + (large ? ' lg' : '');
    const list = cap > 0 ? attempts.slice(-cap) : attempts;
    list.forEach((at) => {
      const tick = document.createElement('span');
      tick.className = 'ci-tick t-' + at.grade;
      tick.title = at.grade;
      strip.appendChild(tick);
    });
    return strip;
  }

  window.attemptSummary = { mastery, readiness, MASTERY_LABEL, badgeEl, ciStripEl };
})();
