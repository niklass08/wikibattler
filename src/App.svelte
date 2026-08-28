<script lang="ts">
  import { view } from './stores/view';
  import NavBar from './components/NavBar.svelte';
  import PackOpener from './components/PackOpener.svelte';
  import Collection from './components/Collection.svelte';
</script>

<NavBar />

<main>
  {#if $view === 'open'}
    <PackOpener />
  {:else}
    <Collection />
  {/if}
</main>

<footer class="wrap">
  <span>Cards & images from Wikipedia, under their respective licenses.</span>
</footer>

<style>
  main {
    min-height: calc(100dvh - 58px - 60px);
  }
  footer {
    padding-block: 22px;
    color: var(--text-faint);
    font-size: 11px;
    text-align: center;
    border-top: 1px solid var(--line);
  }
</style>
