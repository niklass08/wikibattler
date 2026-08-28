import './styles/global.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { loadPools } from './lib/pools';

const target = document.getElementById('app');
if (!target) throw new Error('#app not found');

// Load the (code-split) card pool before the first render so every component
// can read it synchronously.
const app = loadPools().then(() => {
  document.getElementById('boot')?.remove();
  return mount(App, { target });
});

export default app;
