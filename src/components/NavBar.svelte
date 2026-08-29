<script lang="ts">
  import { view } from '../stores/view';
  import { collection } from '../lib/collection';

  const owned = $derived(Object.keys($collection).length);
</script>

<header class="nav">
  <div class="wrap bar">
    <button class="mark" onclick={() => view.set('open')}>
      Wiki<span>TCG</span>
    </button>

    <nav>
      <button class:active={$view === 'open'} onclick={() => view.set('open')}>Open</button>
      <button class:active={$view === 'collection'} onclick={() => view.set('collection')}>
        Collection
        {#if owned > 0}<span class="count mono">{owned}</span>{/if}
      </button>
      {#if owned > 0}
        <button class:active={$view === 'battle'} onclick={() => view.set('battle')}>
          Battle <span class="tag mono">beta</span>
        </button>
      {/if}
      <button class="help" class:active={$view === 'help'} onclick={() => view.set('help')}>
        Help
      </button>
    </nav>
  </div>
</header>

<style>
  .nav {
    position: sticky;
    top: 0;
    z-index: 20;
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 68px;
  }
  .mark {
    font-weight: 700;
    letter-spacing: -0.02em;
    font-size: 20px;
  }
  .mark span {
    color: var(--text-dim);
  }
  nav {
    display: flex;
    gap: 4px;
  }
  nav button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-weight: 500;
    font-size: 15px;
    transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
  }
  nav button:hover {
    color: var(--text);
  }
  nav button.active {
    color: var(--text);
    background: var(--surface);
  }
  .count {
    font-size: 12px;
    color: var(--text-faint);
  }
  nav button.help {
    color: var(--text-faint);
  }
  nav button.help:hover,
  nav button.help.active {
    color: var(--text);
  }
  .tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--mythic);
    padding: 1px 4px;
    border-radius: 4px;
  }
</style>
