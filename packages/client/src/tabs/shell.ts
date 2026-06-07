import { renderLearn } from './learn.js';
import { renderManage } from './manage.js';
import { renderPractice } from './practice.js';
import { buildHash, parseHash, type ManageLocation, type TabId } from './route.js';

const TABS: { id: TabId; label: string }[] = [
  { id: 'learn', label: 'Learn' },
  { id: 'practice', label: 'Practice' },
  { id: 'manage', label: 'Manage' },
];

/**
 * Build the three-tab shell into the given root element. The URL hash is the
 * single source of truth: tab clicks and in-tab navigation update the hash, and
 * a single `hashchange` handler re-renders, so a refresh (or back/forward)
 * restores the active tab and the Manage drill-down position.
 */
export function mountShell(root: HTMLElement): void {
  root.innerHTML = '';

  const panels = document.createElement('div');
  panels.className = 'tab-panels';

  const bar = document.createElement('nav');
  bar.className = 'tab-bar';

  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    // Navigating sets the hash; the hashchange handler does the actual render.
    btn.addEventListener('click', () => {
      location.hash = buildHash({ tab: tab.id, manage: {} });
    });
    bar.appendChild(btn);
  }

  root.appendChild(panels);
  root.appendChild(bar);

  /** Write the Manage location into the hash without forcing a tab switch. */
  function navigateManage(manage: ManageLocation): void {
    location.hash = buildHash({ tab: 'manage', manage });
  }

  function render(): void {
    const route = parseHash(location.hash);

    for (const btn of bar.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.tab === route.tab);
    }

    if (route.tab === 'learn') renderLearn(panels);
    else if (route.tab === 'practice') renderPractice(panels);
    else renderManage(panels, route.manage, navigateManage);
  }

  window.addEventListener('hashchange', render);

  // No hash yet (fresh load on bare URL) → seed the default so the URL reflects state.
  if (location.hash === '') {
    location.replace(`${location.pathname}${location.search}#/manage`);
  }
  render();
}
