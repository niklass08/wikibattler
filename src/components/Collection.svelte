<script lang="ts">
  import { collection, computeProgress } from '../lib/collection';
  import { cardById, totalsByRarity } from '../lib/pools';
  import { RARITIES, type Rarity } from '../lib/types';
  import { view } from '../stores/view';
  import Card from './Card.svelte';
  import CardDetail from './CardDetail.svelte';
  import type { Card as CardT } from '../lib/types';

  type Sort = 'recent' | 'name' | 'strength' | 'defence';

  let rarityFilter = $state<Rarity | 'all'>('all');
  let sort = $state<Sort>('recent');
  let detail = $state<CardT | null>(null);

  const progress = $derived(computeProgress($collection, cardById, totalsByRarity));

  const owned = $derived(
    Object.keys($collection)
      .map((id) => cardById.get(Number(id)))
      .filter((c): c is CardT => !!c)
  );

  const shown = $derived(
    owned
      .filter((c) => rarityFilter === 'all' || c.rarity === rarityFilter)
      .sort((a, b) => {
        if (sort === 'name') return a.title.localeCompare(b.title);
        if (sort === 'strength') return b.strength - a.strength;
        if (sort === 'defence') return b.defence - a.defence;
        const ta = $collection[a.id]?.firstOpenedAt ?? '';
        const tb = $collection[b.id]?.firstOpenedAt ?? '';
        return tb.localeCompare(ta);
      })
  );

  const pct = $derived(
    progress.total > 0 ? Math.round((progress.ownedUnique / progress.total) * 100) : 0
  );
</script>

<section class="collection wrap">
  {#if owned.length === 0}
    <div class="empty">
      <p>Your collection is empty.</p>
      <button class="btn" onclick={() => view.set('open')}>Open your first pack →</button>
    </div>
  {:else}
    <header class="head">
      <div>
        <h1>Collection</h1>
        <p class="sub mono">{progress.ownedUnique} / {progress.total} unique · {pct}%</p>
      </div>
      <div class="meters">
        {#each progress.perRarity as r (r.rarity)}
          <div class="meter rarity-{r.rarity}" title="{r.owned} of {r.total}">
            <div class="track"><div class="fill" style="width:{r.total ? (r.owned / r.total) * 100 : 0}%"></div></div>
            <span class="mono">{r.owned}/{r.total}</span>
          </div>
        {/each}
      </div>
    </header>

    <div class="filters">
      <div class="chips">
        <button class:on={rarityFilter === 'all'} onclick={() => (rarityFilter = 'all')}>All</button>
        {#each RARITIES as r (r)}
          <button
            class="rarity-{r}"
            class:on={rarityFilter === r}
            onclick={() => (rarityFilter = r)}
          >
            {r}
          </button>
        {/each}
      </div>
      <label class="sort">
        Sort
        <select bind:value={sort}>
          <option value="recent">Recent</option>
          <option value="name">Name</option>
          <option value="strength">Strength</option>
          <option value="defence">Defence</option>
        </select>
      </label>
    </div>

    <div class="grid">
      {#each shown as card (card.id)}
        <Card
          {card}
          dupCount={$collection[card.id]?.count ?? 1}
          onclick={() => (detail = card)}
        />
      {/each}
    </div>
  {/if}
</section>

{#if detail}
  <CardDetail card={detail} onclose={() => (detail = null)} />
{/if}

<style>
  .collection {
    padding-block: clamp(28px, 6vh, 56px);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding-block: 18vh;
    color: var(--text-dim);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-end;
    gap: 20px;
    margin-bottom: 22px;
  }
  h1 {
    font-size: clamp(22px, 4vw, 30px);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .sub {
    color: var(--text-dim);
    font-size: 12px;
    margin-top: 4px;
  }
  .meters {
    display: grid;
    grid-template-columns: repeat(4, minmax(72px, 1fr));
    gap: 12px;
    min-width: min(340px, 100%);
  }
  .meter {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 10px;
    color: var(--text-faint);
  }
  .track {
    height: 3px;
    border-radius: 2px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 400ms var(--ease);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 22px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chips button {
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 12px;
    text-transform: capitalize;
    color: var(--text-dim);
    transition: all var(--dur) var(--ease);
  }
  .chips button:hover {
    color: var(--text);
  }
  .chips button.on {
    color: var(--text);
    border-color: var(--accent, var(--text));
    background: color-mix(in srgb, var(--accent, var(--text)) 14%, transparent);
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .sort select {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: clamp(12px, 2vw, 22px);
  }
</style>
