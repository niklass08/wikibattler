<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import type { Card as CardT } from '../lib/types';
  import Card from './Card.svelte';
  import RarityBadge from './RarityBadge.svelte';
  import { collection } from '../lib/collection';

  let { card, onclose }: { card: CardT; onclose: () => void } = $props();

  const count = $derived($collection[card.id]?.count ?? 0);

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
      <Card {card} dupCount={count} />
    </div>

    <div class="info">
      <RarityBadge rarity={card.rarity} />
      <h2>{card.title}</h2>
      <p class="extract">{card.extract || 'No summary available.'}</p>

      <dl class="grid mono">
        <div><dt>Strength</dt><dd>{card.strength}</dd><dd class="raw">{card.raw.links.toLocaleString()} links</dd></div>
        <div><dt>Defence</dt><dd>{card.defence}</dd><dd class="raw">{card.raw.bytes.toLocaleString()} bytes</dd></div>
        <div><dt>Popularity</dt><dd>{card.raw.monthlyViews.toLocaleString()}</dd><dd class="raw">views / month</dd></div>
        <div><dt>Owned</dt><dd>{count}</dd><dd class="raw">cop{count === 1 ? 'y' : 'ies'}</dd></div>
      </dl>

      <div class="foot">
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
    grid-template-columns: 240px 1fr;
    gap: 28px;
    width: min(680px, 100%);
    max-height: 90dvh;
    overflow: auto;
    padding: 24px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .art {
    width: 240px;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  h2 {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  .extract {
    color: var(--text-dim);
    font-size: 14px;
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
    font-size: 13px;
    padding: 10px 14px;
  }

  @media (max-width: 560px) {
    .panel {
      grid-template-columns: 1fr;
      justify-items: center;
    }
    .info {
      width: 100%;
    }
  }
</style>
