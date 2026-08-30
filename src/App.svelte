<script lang="ts">
  import { view } from './stores/view';
  import NavBar from './components/NavBar.svelte';
  import PackOpener from './components/PackOpener.svelte';
  import Collection from './components/Collection.svelte';
  import Battle from './components/Battle.svelte';
  import Shop from './components/Shop.svelte';
  import Help from './components/Help.svelte';

  // Arena pulls in the Firebase SDK — load it (and its chunk) only on demand so
  // Open / Collection / Battle stay light and fully offline-capable.
  const Arena = () => import('./components/Arena.svelte');
</script>

<NavBar />

<main>
  {#if $view === 'open'}
    <PackOpener />
  {:else if $view === 'battle'}
    <Battle />
  {:else if $view === 'arena'}
    {#await Arena() then M}
      <M.default />
    {:catch}
      <p class="load-fail wrap">The Arena failed to load — check your connection and try again.</p>
    {/await}
  {:else if $view === 'shop'}
    <Shop />
  {:else if $view === 'help'}
    <Help />
  {:else}
    <Collection />
  {/if}
</main>

<footer class="wrap">
  <span>Cards & images from Wikipedia, under their respective licenses.</span>
</footer>

<style>
  main {
    /* the safe-area insets are added to the sticky nav and the footer, so take
       them off here too or the page gains that much dead scroll on a notched
       device */
    min-height: calc(
      100dvh - var(--nav-h) - var(--footer-h) - env(safe-area-inset-top) -
        env(safe-area-inset-bottom)
    );
  }
  .load-fail {
    padding-block: 18vh;
    text-align: center;
    color: var(--text-dim);
    font-size: 14px;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: center;
    /* grow by the inset rather than letting border-box eat into the text */
    height: calc(var(--footer-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    color: var(--text-faint);
    font-size: 12px;
    text-align: center;
    border-top: 1px solid var(--line);
  }
</style>
