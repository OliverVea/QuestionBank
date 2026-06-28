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
import { FigureScanPage } from '@/pages/FigureScanPage';
import { ManageBooksPage } from '@/pages/ManageBooksPage';
import { EditBookPage } from '@/pages/EditBookPage';
import { ViewBookPage } from '@/pages/ViewBookPage';
import { AttemptsPage } from '@/pages/AttemptsPage';
import { LearnPage } from '@/pages/LearnPage';
import { RevisitPage } from '@/pages/RevisitPage';
import { GradePage } from '@/pages/GradePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { getAccessToken, handleCallback, login } from '@/lib/auth';
import { AuthCallbackPage } from '@/pages/AuthCallbackPage';

const app = document.getElementById('app')!;

function mount(page: () => HTMLElement): void {
  app.replaceChildren(page());
}

function setupRouter(): void {
  const router = new Navigo('/', { hash: true });
  router
    .on('/', () => mount(LandingPage))
    .on('/add-book', () => mount(AddBookPage))
    .on('/scan-problems', () => mount(ScanProblemsPage))
    .on('/figure-scan', () => mount(FigureScanPage))
    .on('/manage-books', () => mount(ManageBooksPage))
    .on('/edit-book', () => mount(EditBookPage))
    .on('/view-book', () => mount(ViewBookPage))
    .on('/attempts', () => mount(AttemptsPage))
    .on('/learn', () => mount(LearnPage))
    .on('/revisit', () => mount(RevisitPage))
    .on('/grade', () => mount(GradePage))
    .on('/settings', () => mount(SettingsPage))
    .resolve();
}

async function bootstrap(): Promise<void> {
  // 1. OIDC redirect landing: exchange the code, then resume at a clean URL.
  if (window.location.pathname === '/auth/callback') {
    mount(AuthCallbackPage);
    try {
      const returnTo = await handleCallback();
      // Replace so the back button never returns to the callback URL.
      window.location.replace(returnTo || '/');
    } catch {
      await login('/'); // state mismatch / no flow → restart login
    }
    return;
  }

  // 2. Normal load: require a token, else start login (redirects away).
  const token = await getAccessToken();
  if (!token) {
    await login();
    return;
  }

  // 3. Authenticated: render the app.
  setupRouter();
}

void bootstrap();
