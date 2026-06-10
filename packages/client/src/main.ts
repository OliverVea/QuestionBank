// Global styles: the central palette/tokens and base reset, ported from the
// mocks. Imported here so Vite bundles them and the base look is established
// app-wide. Per-component CSS is co-located and imported by its component.
import './styles/tokens.css';
import './styles/reset.css';

// #app is intentionally empty this session — there are no pages yet. Page
// mounting and the router (Navigo, hash mode) land with the first page; see
// docs/client/approach.md.
const root = document.getElementById('app');
void root;
