<script lang="ts">
  import { collection, computeProgress, packsOpened } from '../lib/collection';
  import { RARITIES, type Rarity } from '../lib/types';
  import { TAG_LABEL, TAGS, deriveTags, type Tag } from '../lib/tags';
  import { view } from '../stores/view';
  import { fetchCategories } from '../lib/wiki';
  import Card from './Card.svelte';
  import CardDetail from './CardDetail.svelte';
  import type { Card as CardT } from '../lib/types';

  type Sort = 'recent' | 'name' | 'rarity' | 'foil' | 'dupes' | 'strength' | 'defence';

  let rarityFilter = $state<Rarity | 'all'>('all');
  let tagFilter = $state<Tag | 'all'>('all');
  let sort = $state<Sort>('recent');
  let detail = $state<CardT | null>(null);

  const progress = $derived(computeProgress($collection));

  const owned = $derived(Object.values($collection).map((e) => e.card));

  // tags present in the collection, in canonical order — drives the filter row
  const tagsInUse = $derived(
    (() => {
      const seen = new Set<string>();
      for (const c of owned) for (const t of c.tags ?? []) seen.add(t);
      return TAGS.filter((t) => seen.has(t));
    })()
  );

  // Backfill tags on cards pulled before the tag system, in a few batched calls.
  const sweptForTags = new Set<number>();
  let sweeping = false;
  $effect(() => {
    const untagged = Object.values($collection)
      .filter((e) => !sweptForTags.has(e.card.id) && !(e.card.tags?.length))
      .map((e) => e.card);
    if (untagged.length === 0 || sweeping) return;
    sweeping = true;
    (async () => {
      for (let i = 0; i < untagged.length; i += 12) {
        const batch = untagged.slice(i, i + 12);
        const cats = await fetchCategories(batch.map((c) => c.title));
        for (const card of batch) {
          sweptForTags.add(card.id);
          const tags = deriveTags(cats.get(card.title) ?? [], card.extract);
          if (tags.length) collection.setTags(card.id, tags);
        }
      }
      sweeping = false;
    })();
  });

  const shown = $derived(
    owned
      .filter((c) => rarityFilter === 'all' || c.rarity === rarityFilter)
      .filter((c) => tagFilter === 'all' || (c.tags ?? []).includes(tagFilter))
      .sort((a, b) => {
        if (sort === 'name') return a.title.localeCompare(b.title);
        if (sort === 'strength') return b.strength - a.strength;
        if (sort === 'defence') return b.defence - a.defence;
        if (sort === 'rarity') {
          const d = RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity);
          return d !== 0 ? d : a.title.localeCompare(b.title);
        }
        if (sort === 'foil') {
          // negated is the scarcer finish — float it above the foil tiers
          const rank = (c: CardT) => (c.negated ? 10 : 0) + (c.foil ?? 0);
          const d = rank(b) - rank(a);
          return d !== 0 ? d : a.title.localeCompare(b.title);
        }
        if (sort === 'dupes') {
          const d = ($collection[b.id]?.count ?? 1) - ($collection[a.id]?.count ?? 1);
          return d !== 0 ? d : a.title.localeCompare(b.title);
        }
        const ta = $collection[a.id]?.firstOpenedAt ?? '';
        const tb = $collection[b.id]?.firstOpenedAt ?? '';
        return tb.localeCompare(ta);
      })
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
        <p class="sub mono">
          {progress.ownedUnique} unique · {progress.totalCards} cards · {$packsOpened} packs
        </p>
      </div>
      <div class="meters">
        {#each progress.perRarity as r (r.rarity)}
          <div class="meter rarity-{r.rarity}">
            <span class="dot"></span>
            <span class="mono">{r.owned}</span>
            <span class="label">{r.rarity}</span>
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
          <option value="rarity">Rarity</option>
          <option value="foil">Foil &amp; negated</option>
          <option value="dupes">Duplicates</option>
          <option value="strength">Strength</option>
          <option value="defence">Defence</option>
        </select>
      </label>
    </div>

    {#if tagsInUse.length > 0}
      <div class="tags">
        <button class:on={tagFilter === 'all'} onclick={() => (tagFilter = 'all')}>All themes</button>
        {#each tagsInUse as t (t)}
          <button class:on={tagFilter === t} onclick={() => (tagFilter = tagFilter === t ? 'all' : t)}>
            {TAG_LABEL[t]}
          </button>
        {/each}
      </div>
    {/if}

    <div class="grid">
      {#each shown as card (card.id)}
        <Card
          {card}
          dupCount={$collection[card.id]?.count ?? 1}
          onclick={() => (detail = card)}
          onResolveImage={(url) => collection.setImage(card.id, url)}
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
    padding-block: clamp(36px, 7vh, 72px);
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
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .sub {
    color: var(--text-dim);
    font-size: 13px;
    margin-top: 6px;
  }
  .meters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .meter {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 12px;
    color: var(--text-dim);
  }
  .meter .dot {
    align-self: center;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 65%, transparent);
  }
  .meter .mono {
    color: var(--text);
    font-size: 13px;
  }
  .meter .label {
    text-transform: capitalize;
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
    padding: 8px 16px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 13px;
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
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: -8px 0 22px;
  }
  .tags button {
    padding: 6px 13px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 12px;
    color: var(--text-dim);
    transition: all var(--dur) var(--ease);
  }
  .tags button:hover {
    color: var(--text);
  }
  .tags button.on {
    color: var(--bg);
    background: var(--text);
    border-color: var(--text);
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .sort select {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 7px 10px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: clamp(16px, 2vw, 28px);
  }
</style>
