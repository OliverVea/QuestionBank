import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { Spinner } from '@/components/Spinner';
import type { Settings } from '@/lib/types';
import '@/styles/forms.css';
import './SettingsPage.css';

/**
 * Settings screen — edits the two weekly goals (study days/week, problems/week)
 * that the home activity header counts toward. Two bare number fields; the sticky
 * "Save changes" button arms only once a goal diverges from the saved baseline.
 *
 * The baseline is the customer's CURRENTLY-STORED goals (fetched on mount), NOT a
 * hardcoded default — so Save arms correctly whatever the saved values are.
 */
export function SettingsPage(): HTMLElement {
  const daysInput = document.createElement('input');
  daysInput.className = 'field-in';
  daysInput.id = 'days-in';
  daysInput.type = 'number';
  daysInput.inputMode = 'numeric';
  daysInput.min = '1';
  daysInput.max = '7';

  const problemsInput = document.createElement('input');
  problemsInput.className = 'field-in';
  problemsInput.id = 'problems-in';
  problemsInput.type = 'number';
  problemsInput.inputMode = 'numeric';
  problemsInput.min = '1';

  const saveBtn = html`<button class="primary-btn" type="submit" form="settings-form" disabled>
    Save changes
  </button>`;

  const saveError = html`<p class="save-error" hidden></p>`;

  // The saved baseline. Filled once the GET lands; until then the inputs are
  // disabled (a spinner stands in) so the user can't edit a stale value.
  let saved: Settings | null = null;

  // Working values; only fall back to the saved baseline when a field is left empty
  // or non-numeric (an in-progress edit shouldn't arm Save).
  function readValue(el: HTMLInputElement, fallback: number): number {
    const n = parseInt(el.value, 10);
    return Number.isNaN(n) ? fallback : n;
  }

  function syncSave(): void {
    if (!saved) {
      (saveBtn as HTMLButtonElement).disabled = true;
      return;
    }
    const days = readValue(daysInput, saved.daysGoal);
    const problems = readValue(problemsInput, saved.problemsGoal);
    const dirty = days !== saved.daysGoal || problems !== saved.problemsGoal;
    (saveBtn as HTMLButtonElement).disabled = !dirty;
  }

  daysInput.addEventListener('input', syncSave);
  problemsInput.addEventListener('input', syncSave);

  const fieldsHost = html`<div class="settings-fields"></div>`;
  fieldsHost.appendChild(Spinner());

  const form = html`<form class="settings-stage" id="settings-form" autocomplete="off">
    <h1 class="settings-title">Settings</h1>

    <section class="goals">
      <div class="section-head">
        <h2>Weekly goals</h2>
        <p class="section-sub">What the activity header on your home screen counts toward.</p>
      </div>
      ${fieldsHost}
    </section>
  </form>`;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!saved) return;
    const daysGoal = readValue(daysInput, saved.daysGoal);
    const problemsGoal = readValue(problemsInput, saved.problemsGoal);

    (saveBtn as HTMLButtonElement).disabled = true;
    saveBtn.textContent = 'Saving…';
    saveError.hidden = true;
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysGoal, problemsGoal }),
      });
      if (!res.ok) throw new Error('Failed to save settings');
      window.location.hash = '#/';
    } catch {
      saveBtn.textContent = 'Save changes';
      (saveBtn as HTMLButtonElement).disabled = false;
      saveError.textContent = "Couldn't save — check the values and try again.";
      saveError.hidden = false;
    }
  });

  const page = html`<div class="settings-page">
    ${TopBar({ onBack: () => { window.location.hash = '#/'; } })}
    ${form}
    <footer class="add-actions">
      ${saveError}
      ${saveBtn}
    </footer>
  </div>`;

  void loadSettings();
  return page;

  async function loadSettings(): Promise<void> {
    const fetched = await fetch('/api/settings')
      .then((r) => (r.ok ? (r.json() as Promise<Settings>) : null))
      .catch(() => null);
    // Fall back to the defaults the server would apply, so the form is still usable offline.
    saved = fetched ?? { daysGoal: 3, problemsGoal: 20 };
    daysInput.value = String(saved.daysGoal);
    problemsInput.value = String(saved.problemsGoal);

    fieldsHost.replaceChildren(
      html`<label class="field">
        <span class="field-lbl">Study days <span class="field-opt">per week</span></span>
        ${daysInput}
      </label>`,
      html`<label class="field field-block">
        <span class="field-lbl">Problems <span class="field-opt">per week</span></span>
        ${problemsInput}
      </label>`,
    );
    saveBtn.textContent = 'Save changes';
    syncSave();
  }
}
