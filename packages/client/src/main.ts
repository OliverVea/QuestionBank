import './styles.css';
import { mountShell } from './tabs/shell.js';

const root = document.getElementById('app');
if (root) mountShell(root);
