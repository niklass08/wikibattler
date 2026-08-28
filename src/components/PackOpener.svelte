<script lang="ts">
  import { fly, scale } from 'svelte/transition';
  import { generatePack } from '../lib/pack';
  import { rarityPools, usingSample } from '../lib/pools';
  import { collection, packsOpened } from '../lib/collection';
  import type { Card as CardT } from '../lib/types';
  import Card from './Card.svelte';
  import CardDetail from './CardDetail.svelte';

  type Phase = 'idle' | 'reveal';

  let phase = $state<Phase>('idle');
  let pack = $state<CardT[]>([]);
  let flipped = $state<boolean[]>([]);
  let newIds = $state<Set<number>>(new Set());
  let detail = $state<CardT | null>(null);

  const allRevealed = $derived(flipped.length > 0 && flipped.every(Boolean));
  const bestRarity = $derived(rank(pack));

  function rank(cards: CardT[]): string {
    const order = ['common', 'uncommon', 'rare', 'mythic'];
    return cards.reduce((best, c) => (order.indexOf(c.rarity) > order.indexOf(best) ? c.rarity : best), 'common');
  }

  function openPack() {
    pack = generatePack(rarityPools);
    flipped = pack.map(() => false);
    newIds = collection.addCards(pack);
    packsOpened.increment();
    phase = 'reveal';
  }

  function flip(i: number) {
    if (flipped[i]) {
      detail = pack[i];
      return;
    }
    flipped[i] = true;
  }

  function revealAll() {
    flipped = flipped.map(() => true);
  }

  function reset() {
    phase = 'idle';
    pack = [];
    flipped = [];
    newIds = new Set();
  }
</script>

<section class="opener wrap">
  {#if phase === 'idle'}
    <div class="idle" in:scale={{ duration: 300, start: 0.94 }}>
      <div class="deck" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <h1>Open a pack</h1>
      <p class="sub">
        Seven cards. Four common, two uncommon, one rare or better.
        {#if usingSample}<br /><em>Running on the sample set — run <code>npm run pools</code> for the full pool.</em>{/if}
      </p>
      <button class="btn" onclick={openPack}>Open pack</button>
      <p class="tally mono">{$packsOpened} opened</p>
    </div>
  {:else}
    <div class="reveal">
      <div class="hand">
        {#each pack as card, i (i)}
          <div
            class="slot"
            class:pop={flipped[i] && (card.rarity === 'rare' || card.rarity === 'mythic')}
            in:fly={{ y: 24, duration: 320, delay: i * 55 }}
          >
            <Card {card} faceDown={!flipped[i]} isNew={newIds.has(card.id)} onclick={() => flip(i)} />
          </div>
        {/each}
      </div>

      <div class="actions">
        {#if !allRevealed}
          <button class="btn btn--ghost" onclick={revealAll}>Reveal all</button>
        {:else}
          <span class="result mono">Best pull: <b class="rarity-{bestRarity}">{bestRarity}</b></span>
          <button class="btn" onclick={reset}>Open another</button>
        {/if}
      </div>
    </div>
  {/if}
</section>

{#if detail}
  <CardDetail card={detail} onclose={() => (detail = null)} />
{/if}

<style>
  .opener {
    padding-block: clamp(32px, 8vh, 80px);
  }
  .idle {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
  }
  .deck {
    position: relative;
    width: 132px;
    height: 184px;
    margin-bottom: 12px;
  }
  .deck span {
    position: absolute;
    inset: 0;
    border-radius: var(--card-radius);
    background: repeating-linear-gradient(
      -45deg,
      var(--surface),
      var(--surface) 8px,
      var(--surface-2) 8px,
      var(--surface-2) 16px
    );
    border: 1px solid var(--line);
  }
  .deck span:nth-child(1) {
    transform: rotate(-7deg) translateY(4px);
  }
  .deck span:nth-child(2) {
    transform: rotate(4deg);
  }
  .deck span:nth-child(3) {
    transform: rotate(-1deg) translateY(-4px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
  }
  h1 {
    font-size: clamp(24px, 5vw, 34px);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .sub {
    color: var(--text-dim);
    max-width: 42ch;
  }
  .sub code {
    font-family: var(--font-mono);
    font-size: 0.9em;
    color: var(--text);
  }
  .tally {
    color: var(--text-faint);
    font-size: 12px;
  }

  .hand {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: clamp(8px, 1.4vw, 16px);
    align-items: start;
  }
  .slot {
    transition: transform var(--dur) var(--ease);
  }
  .slot.pop {
    transform: translateY(-10px) scale(1.03);
    z-index: 2;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 32px;
    min-height: 46px;
  }
  .result {
    color: var(--text-dim);
    font-size: 13px;
  }
  .result b {
    color: var(--accent);
    text-transform: capitalize;
  }

  @media (max-width: 720px) {
    .hand {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  @media (max-width: 420px) {
    .hand {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
