<script lang="ts">
  import { view } from './stores/view';
  import NavBar from './components/NavBar.svelte';
  import PackOpener from './components/PackOpener.svelte';
  import Collection from './components/Collection.svelte';
  import Battle from './components/Battle.svelte';
  import Shop from './components/Shop.svelte';
  import Help from './components/Help.svelte';
  import { storageFull } from './lib/storage';

  // Arena pulls in the Firebase SDK — load it (and its chunk) only on demand so
  // Open / Collection / Battle stay light and fully offline-capable.
  const Arena = () => import('./components/Arena.svelte');
</script>

<NavBar />

{#if $storageFull}
  <!-- A collection outgrows the browser's ~5 MB storage budget somewhere north
       of 8,000 unique cards. Until now that failed silently and every pack
       opened afterwards was lost on reload. -->
  <div class="storage-warn wrap" role="alert">
    <strong>This browser is out of storage.</strong>
    New cards are being kept for this session only and will be lost when you reload. Sign in to save
    your collection to your Google account, or disenchant some duplicates to free up room.
  </div>
{/if}

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
  .storage-warn {
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid var(--mythic, #f0a);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.5;
  }
  .storage-warn strong {
    color: var(--text);
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
