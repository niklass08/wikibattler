import './styles/global.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { start } from './lib/packQueue';

const target = document.getElementById('app');
if (!target) throw new Error('#app not found');

// Cards come from the live Wikimedia API now — nothing to load up front. Mount
// immediately, then start stocking the background pack queue.
document.getElementById('boot')?.remove();
const app = mount(App, { target });
start();

export default app;
