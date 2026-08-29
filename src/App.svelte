<script lang="ts">
  import { view } from './stores/view';
  import NavBar from './components/NavBar.svelte';
  import PackOpener from './components/PackOpener.svelte';
  import Collection from './components/Collection.svelte';
  import Battle from './components/Battle.svelte';
</script>

<NavBar />

<main>
  {#if $view === 'open'}
    <PackOpener />
  {:else if $view === 'battle'}
    <Battle />
  {:else}
    <Collection />
  {/if}
</main>

<footer class="wrap">
  <span>Cards & images from Wikipedia, under their respective licenses.</span>
</footer>

<style>
  main {
    min-height: calc(100dvh - var(--nav-h) - var(--footer-h));
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--footer-h);
    color: var(--text-faint);
    font-size: 12px;
    text-align: center;
    border-top: 1px solid var(--line);
  }
</style>
