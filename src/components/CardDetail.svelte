<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { FOIL_LABEL, NEGATED_LABEL, type Card as CardT } from '../lib/types';
  import { STAT_MAX } from '../lib/rarity';
  import { TAG_LABEL, type Tag } from '../lib/tags';
  import Card from './Card.svelte';
  import RarityBadge from './RarityBadge.svelte';
  import { collection, favourites } from '../lib/collection';

  let { card, onclose }: { card: CardT; onclose: () => void } = $props();

  const count = $derived($collection[card.id]?.count ?? 0);
  const isFav = $derived($favourites.has(card.id));

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window on:keydown={onkey} />

<div class="backdrop" transition:fade={{ duration: 180 }}>
  <button class="scrim" type="button" aria-label="Close" onclick={onclose}></button>
  <div
    class="panel rarity-{card.rarity}"
    transition:scale={{ duration: 220, start: 0.95 }}
    role="dialog"
    aria-modal="true"
    aria-label={card.title}
    tabindex="-1"
  >
    <div class="art">
      <Card {card} dupCount={count} onResolveImage={(url) => collection.setImage(card.id, url)} />
    </div>

    <div class="info">
      <div class="badges">
        <RarityBadge rarity={card.rarity} />
        {#if card.foil}
          <span class="foil-chip foil-{card.foil}">✦ {FOIL_LABEL[card.foil]} foil</span>
        {/if}
        {#if card.negated}
          <span class="negated-chip">◐ {NEGATED_LABEL}</span>
        {/if}
        {#each (card.tags ?? []) as t (t)}
          <span class="tag-chip">{TAG_LABEL[t as Tag] ?? t}</span>
        {/each}
      </div>
      <h2>{card.title}</h2>
      <p class="extract">{card.extract || 'No summary available.'}</p>

      <dl class="grid mono">
        <div><dt>Strength</dt><dd>{card.strength}<span class="max">/{STAT_MAX}</span></dd><dd class="raw">{card.raw.links.toLocaleString()} links</dd></div>
        <div><dt>Defence</dt><dd>{card.defence}<span class="max">/{STAT_MAX}</span></dd><dd class="raw">{card.raw.bytes.toLocaleString()} bytes</dd></div>
        <div><dt>Popularity</dt><dd>{card.raw.monthlyViews.toLocaleString()}</dd><dd class="raw">views / month</dd></div>
        <div><dt>Owned</dt><dd>{count}</dd><dd class="raw">cop{count === 1 ? 'y' : 'ies'}</dd></div>
      </dl>

      <div class="foot">
        <button
          class="btn btn--ghost fav"
          class:on={isFav}
          aria-pressed={isFav}
          onclick={() => favourites.toggle(card.id)}
        >
          {isFav ? '★ Favourited' : '☆ Favourite'}
        </button>
        <a class="btn btn--ghost" href={card.url} target="_blank" rel="noopener noreferrer">
          Read on Wikipedia ↗
        </a>
        <button class="btn" onclick={onclose}>Close</button>
      </div>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: var(--pad);
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    backdrop-filter: blur(6px);
  }
  .scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background: none;
  }
  .panel {
    position: relative;
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 36px;
    width: min(820px, 100%);
    max-height: 90dvh;
    overflow: auto;
    padding: 32px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .art {
    width: 300px;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .badges {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 10px;
  }
  .tag-chip {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-dim);
  }
  .foil-chip {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid currentColor;
    color: var(--foil-1);
  }
  .foil-chip.foil-2 {
    color: var(--foil-2);
  }
  .foil-chip.foil-3 {
    color: var(--foil-3);
    text-shadow: 0 0 8px color-mix(in srgb, var(--foil-3) 55%, transparent);
  }
  .negated-chip {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 999px;
    color: var(--bg);
    background: var(--text);
  }
  h2 {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  .extract {
    color: var(--text-dim);
    font-size: 15px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 20px;
    margin-top: 4px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .grid dt {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .grid dd {
    font-size: 18px;
    color: var(--text);
  }
  .grid dd .max {
    font-size: 11px;
    color: var(--text-faint);
    margin-left: 1px;
  }
  .grid dd.raw {
    font-size: 11px;
    color: var(--text-dim);
  }
  .foot {
    display: flex;
    gap: 10px;
    margin-top: auto;
    padding-top: 8px;
  }
  .foot .btn {
    flex: 1;
    font-size: 14px;
    padding: 12px 16px;
  }
  .foot .fav {
    flex: 0 0 auto;
  }
  .foot .fav.on {
    color: #f5c518;
    border-color: color-mix(in srgb, #f5c518 55%, transparent);
  }

  @media (max-width: 620px) {
    .panel {
      grid-template-columns: 1fr;
      justify-items: center;
    }
    .info {
      width: 100%;
    }
  }
</style>
