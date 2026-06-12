// Global styles: the central palette/tokens and base reset, ported from the
// mocks. Imported here so Vite bundles them and the base look is established
// app-wide. Per-component CSS is co-located and imported by its component.
import './styles/tokens.css';
import './styles/reset.css';
import 'katex/dist/katex.min.css';

import Navigo from 'navigo';
import { LandingPage } from '@/pages/LandingPage';
import { AddBookPage } from '@/pages/AddBookPage';
import { ScanProblemsPage } from '@/pages/ScanProblemsPage';
import { ManageBooksPage } from '@/pages/ManageBooksPage';
import { EditBookPage } from '@/pages/EditBookPage';
import { LearnPage } from '@/pages/LearnPage';
import { GradePage } from '@/pages/GradePage';

const app = document.getElementById('app')!;
const router = new Navigo('/', { hash: true });

function mount(page: () => HTMLElement) {
  app.replaceChildren(page());
}

router
  .on('/', () => mount(LandingPage))
  .on('/add-book', () => mount(AddBookPage))
  .on('/scan-problems', () => mount(ScanProblemsPage))
  .on('/manage-books', () => mount(ManageBooksPage))
  .on('/edit-book', () => mount(EditBookPage))
  .on('/learn', () => mount(LearnPage))
  .on('/grade', () => mount(GradePage))
  .resolve();
