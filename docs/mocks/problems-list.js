// Shared problems-list component for the add-book / edit-book mocks.
//
// A book is a FLAT, ORDERED list of problems (no chapters). Each problem has a
// required label (e.g. "1.A.3") and required LaTeX text. This module renders
// the list and owns its interactions:
//
//   - Label: auto-numbered by position (1, 2, 3…) and renumbered on reorder,
//     UNLESS the user types a custom label, which pins to that problem. Clearing
//     a custom label reverts it to the auto-index.
//   - LaTeX text: rendered with KaTeX by default; tap to edit → raw-LaTeX field
//     showing just the source; Enter or blur commits and re-renders.
//   - Drag handle (left) reorders via a lifted row + placeholder gap (the same
//     pointer-drag pattern used on the manage-books list).
//   - Trash (right) deletes the row.
//   - [+ add problem] appends a blank row (auto-label, empty LaTeX in edit mode).
//
// It's lifted into a shared file (like footer.js) because add-book and edit-book
// need the exact same behavior. Mock-only: no persistence.
//
// Usage:
//   const list = initProblemsList({
//     host: document.getElementById('problem-list'),
//     addButton: document.getElementById('add-problem'),
//     problems: [{ label: null, latex: '$x^2$' }, ...],  // label null = auto
//     onChange: () => {},   // called on any edit/add/delete/reorder (dirty hook)
//   });
//   list.getProblems();   // -> [{ label, latex }]  (label is the effective text)

(() => {
  // ---- LaTeX parsing (kept identical to learn.html / grade.html) ----------
  function findClosingDollar(source, from, display) {
    for (let j = from; j < source.length; j++) {
      if (source[j] === '\\') { j++; continue; }
      if (source[j] === '$') {
        if (display) { if (source[j + 1] === '$') return j; continue; }
        return j;
      }
    }
    return -1;
  }
  function splitMath(source) {
    const segments = [];
    let text = '';
    const pushText = () => { if (text.length > 0) segments.push({ kind: 'text', value: text }); text = ''; };
    let i = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\' && source[i + 1] === '$') { text += '$'; i += 2; continue; }
      if (ch === '$') {
        const display = source[i + 1] === '$';
        const open = display ? i + 2 : i + 1;
        const close = findClosingDollar(source, open, display);
        if (close === -1) { text += ch; i += 1; continue; }
        pushText();
        segments.push({ kind: 'math', value: source.slice(open, close), display });
        i = display ? close + 2 : close + 1;
        continue;
      }
      text += ch; i += 1;
    }
    pushText();
    return segments;
  }
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  function renderLatex(host, source) {
    host.innerHTML = '';
    if (!source) {
      const ph = document.createElement('span');
      ph.className = 'pr-empty';
      ph.textContent = 'Tap to write the problem (LaTeX)…';
      host.appendChild(ph);
      return;
    }
    for (const seg of splitMath(source)) {
      if (seg.kind === 'text') {
        const span = document.createElement('span');
        span.innerHTML = escapeHtml(seg.value).replace(/\n/g, '<br>');
        host.appendChild(span);
        continue;
      }
      const mathHost = seg.display ? document.createElement('div') : document.createElement('span');
      if (window.katex) {
        katex.render(seg.value, mathHost, { displayMode: seg.display, throwOnError: false });
      } else {
        mathHost.textContent = seg.display ? seg.value : '$' + seg.value + '$';
      }
      host.appendChild(mathHost);
    }
  }

  // ---- Component -----------------------------------------------------------
  function initProblemsList({ host, addButton, problems = [], onChange = () => {} }) {
    // Per-row model lives on the element via a backing object map.
    const rows = [];   // array of { el, custom, latex, ... } in DOM order

    const markChanged = () => { renumber(); onChange(); };

    // Recompute the displayed label for every auto (non-custom) row from its
    // current position. Custom labels are left untouched.
    function renumber() {
      [...host.children].forEach((el, i) => {
        const r = el._row;
        if (!r) return;
        if (r.custom == null || r.custom === '') {
          r.labelInput.value = String(i + 1);
          r.labelInput.classList.add('auto');
        } else {
          r.labelInput.classList.remove('auto');
        }
      });
    }

    function addRow(problem = { label: null, latex: '' }, { focus = false } = {}) {
      const el = document.createElement('li');
      el.className = 'pr-row';

      // Left drag handle.
      const handle = document.createElement('span');
      handle.className = 'pr-handle';
      handle.setAttribute('aria-label', 'Drag to reorder');
      handle.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
        </svg>`;

      // Label input (auto-index unless a custom value is typed).
      const labelInput = document.createElement('input');
      labelInput.className = 'pr-label';
      labelInput.setAttribute('aria-label', 'Problem label');
      labelInput.value = problem.label != null ? problem.label : '';

      // LaTeX: a rendered view that swaps to a raw editor on tap.
      const body = document.createElement('div');
      body.className = 'pr-body';
      const rendered = document.createElement('div');
      rendered.className = 'pr-rendered';
      const editor = document.createElement('textarea');
      editor.className = 'pr-editor';
      editor.rows = 2;
      editor.placeholder = 'Problem statement in LaTeX, e.g. $\\int_0^\\infty e^{-x^2}\\,dx$';
      editor.hidden = true;
      body.append(rendered, editor);

      // Trash (right).
      const del = document.createElement('button');
      del.className = 'pr-del';
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete problem');
      del.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" />
          <path d="M10 11v6M14 11v6" />
        </svg>`;

      el.append(handle, labelInput, body, del);

      const r = {
        el, labelInput, rendered, editor,
        custom: (problem.label != null && problem.label !== '') ? problem.label : null,
        latex: problem.latex || '',
      };
      el._row = r;
      rows.push(r);

      // ---- Label editing ----
      labelInput.addEventListener('input', () => {
        // A non-empty value the user typed becomes a custom label; empty reverts
        // to auto. We can't perfectly distinguish a typed "3" from the auto "3",
        // but treating any focused edit as custom is the intuitive behavior.
        r.custom = labelInput.value.trim() === '' ? null : labelInput.value;
        markChanged();
      });
      labelInput.addEventListener('blur', () => { renumber(); });

      // ---- LaTeX render <-> edit ----
      renderLatex(rendered, r.latex);
      function enterEdit() {
        editor.value = r.latex;
        editor.hidden = false;
        rendered.hidden = true;
        editor.focus();
        // place caret at end
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }
      function commitEdit() {
        if (editor.hidden) return;
        const next = editor.value;
        const changed = next !== r.latex;
        r.latex = next;
        editor.hidden = true;
        rendered.hidden = false;
        renderLatex(rendered, r.latex);
        if (changed) onChange();
      }
      rendered.addEventListener('click', enterEdit);
      editor.addEventListener('blur', commitEdit);
      editor.addEventListener('keydown', (e) => {
        // Enter commits; Shift+Enter inserts a newline (LaTeX can be multi-line).
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
        if (e.key === 'Escape') { e.preventDefault(); editor.value = r.latex; commitEdit(); }
      });

      // ---- Delete ----
      del.addEventListener('click', () => {
        const i = rows.indexOf(r);
        if (i >= 0) rows.splice(i, 1);
        el.remove();
        markChanged();
      });

      // ---- Drag to reorder (lift + placeholder gap) ----
      makeDraggable(el, handle);

      host.appendChild(el);
      renumber();
      if (focus) enterEdit();
      return r;
    }

    // Pointer-drag reorder: pin the row to the viewport so it tracks the finger,
    // leave a same-height spacer as the visible gap, and slide the spacer as the
    // drag center crosses neighbors. (Same approach as manage-books.html.)
    function makeDraggable(row, handle) {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const startRect = row.getBoundingClientRect();
        const grabOffsetY = e.clientY - startRect.top;
        let moved = false;

        const spacer = document.createElement('li');
        spacer.className = 'pr-spacer';
        spacer.style.height = startRect.height + 'px';
        host.insertBefore(spacer, row);

        row.classList.add('dragging');
        row.style.width = startRect.width + 'px';
        row.style.left = startRect.left + 'px';
        row.style.top = startRect.top + 'px';
        handle.setPointerCapture(e.pointerId);

        const onMove = (ev) => {
          if (!moved && Math.abs(ev.clientY - startRect.top - grabOffsetY) > 3) moved = true;
          row.style.top = (ev.clientY - grabOffsetY) + 'px';
          const dragCenter = ev.clientY - grabOffsetY + startRect.height / 2;
          const others = [...host.querySelectorAll('.pr-row:not(.dragging)')];
          let placed = false;
          for (const other of others) {
            const box = other.getBoundingClientRect();
            if (dragCenter < box.top + box.height / 2) {
              if (spacer.nextElementSibling !== other) host.insertBefore(spacer, other);
              placed = true;
              break;
            }
          }
          if (!placed && host.lastElementChild !== spacer) host.appendChild(spacer);
        };
        const onUp = (ev) => {
          handle.releasePointerCapture(ev.pointerId);
          host.insertBefore(row, spacer);
          spacer.remove();
          row.classList.remove('dragging');
          row.style.cssText = row.style.cssText.replace(/(width|left|top):[^;]+;?/g, '');
          // Keep `rows` array in DOM order.
          rows.sort((a, b) => [...host.children].indexOf(a.el) - [...host.children].indexOf(b.el));
          if (moved) markChanged();
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    }

    // ---- Public API ----
    if (addButton) {
      addButton.addEventListener('click', () => {
        addRow({ label: null, latex: '' }, { focus: true });
        markChanged();
      });
    }
    problems.forEach((p) => addRow(p));
    renumber();

    return {
      // Effective problems in DOM order; label is the displayed text.
      getProblems() {
        return [...host.children]
          .map((el) => el._row)
          .filter(Boolean)
          .map((r) => ({ label: r.labelInput.value.trim(), latex: r.latex.trim() }));
      },
      addRow,
    };
  }

  // Expose to the inline page scripts.
  window.initProblemsList = initProblemsList;
})();
