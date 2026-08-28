<script lang="ts">
  import { view } from '../stores/view';
  import { collection } from '../lib/collection';
  import { cardById, totalCards } from '../lib/pools';

  const owned = $derived(
    Object.keys($collection).filter((id) => cardById.has(Number(id))).length
  );
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
        <span class="count mono">{owned}/{totalCards}</span>
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
    height: 58px;
  }
  .mark {
    font-weight: 700;
    letter-spacing: -0.02em;
    font-size: 16px;
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
    padding: 7px 12px;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-weight: 500;
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
    font-size: 11px;
    color: var(--text-faint);
  }
</style>
