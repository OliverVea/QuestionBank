import { renderLearn } from './learn.js';
import { renderManage } from './manage.js';
import { renderPractice } from './practice.js';

type TabId = 'learn' | 'practice' | 'manage';

const TABS: { id: TabId; label: string; render: (host: HTMLElement) => void }[] = [
  { id: 'learn', label: 'Learn', render: renderLearn },
  { id: 'practice', label: 'Practice', render: renderPractice },
  { id: 'manage', label: 'Manage', render: renderManage },
];

/** Build the three-tab shell into the given root element. */
export function mountShell(root: HTMLElement): void {
  root.innerHTML = '';

  const panels = document.createElement('div');
  panels.className = 'tab-panels';

  const bar = document.createElement('nav');
  bar.className = 'tab-bar';

  let active: TabId = 'manage';

  function select(id: TabId): void {
    active = id;
    for (const btn of bar.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.tab === id);
    }
    const tab = TABS.find((t) => t.id === id)!;
    tab.render(panels);
  }

  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.addEventListener('click', () => select(tab.id));
    bar.appendChild(btn);
  }

  root.appendChild(panels);
  root.appendChild(bar);
  select(active);
}
