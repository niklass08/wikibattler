<script lang="ts">
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { collection, packsOpened } from '../lib/collection';
  import { take, retry, status as queueStatus, MAX_PREFETCH } from '../lib/packQueue';
  import { FOIL_LABEL, type Card as CardT, type FoilTier } from '../lib/types';
  import Card from './Card.svelte';
  import CardBack from './CardBack.svelte';
  import CardDetail from './CardDetail.svelte';

  type Phase = 'idle' | 'waiting' | 'reveal';

  let phase = $state<Phase>('idle');
  let pack = $state<CardT[]>([]);
  let opened = $state(0);
  let newIds = $state<Set<number>>(new Set());
  let detail = $state<CardT | null>(null);

  const remaining = $derived(pack.slice(opened));
  const drawn = $derived(pack.slice(0, opened));
  const allOpen = $derived(pack.length > 0 && opened >= pack.length);
  const bestRarity = $derived(rank(drawn));
  const packFoil = $derived<FoilTier>(
    pack.reduce<FoilTier>((m, c) => (((c.foil ?? 0) > m ? c.foil : m) as FoilTier), 0)
  );

  function rank(cards: CardT[]): string {
    const order = ['common', 'uncommon', 'rare', 'mythic'];
    return cards.reduce((best, c) => (order.indexOf(c.rarity) > order.indexOf(best) ? c.rarity : best), 'common');
  }

  function startReveal(cards: CardT[]) {
    pack = cards;
    opened = 0;
    newIds = collection.addCards(cards);
    packsOpened.increment();
    phase = 'reveal';
  }

  function openPack() {
    const ready = take();
    if (ready) {
      startReveal(ready);
    } else {
      phase = 'waiting';
    }
  }

  // While waiting, grab the first pack the background queue produces.
  $effect(() => {
    if (phase !== 'waiting') return;
    if ($queueStatus.ready > 0) {
      const ready = take();
      if (ready) startReveal(ready);
    }
  });

  function drawNext() {
    if (opened < pack.length) opened += 1;
  }

  function revealRest() {
    opened = pack.length;
  }

  function onStackKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      drawNext();
    }
  }

  function reset() {
    phase = 'idle';
    pack = [];
    opened = 0;
    newIds = new Set();
  }
</script>

<section class="opener wrap">
  {#if phase === 'idle'}
    <div class="idle" in:scale={{ duration: 300, start: 0.94 }}>
      <button class="deck deck--open" type="button" onclick={openPack} aria-label="Open pack">
        <span class="pane"></span><span class="pane"></span>
        <span class="pane top"><CardBack /></span>
      </button>
      <h1>Open a pack</h1>
      <p class="sub">
        Seven cards drawn live from Wikipedia. Four common, two uncommon, one rare
        or better.
      </p>
      <button class="btn" onclick={openPack}>Open pack</button>
      <p class="tally mono">
        {$packsOpened} opened
        {#if $queueStatus.ready < MAX_PREFETCH && !$queueStatus.error}
          · {$queueStatus.ready}/{MAX_PREFETCH} ready
        {/if}
      </p>
    </div>
  {:else if phase === 'waiting'}
    <div class="waiting" in:scale={{ duration: 300, start: 0.94 }}>
      <div class="deck" aria-hidden="true">
        <span class="pane"></span><span class="pane"></span>
        <span class="pane top"><CardBack /></span>
      </div>
      {#if $queueStatus.error}
        <h1>Couldn't reach Wikipedia</h1>
        <p class="sub">{$queueStatus.error}</p>
        <button class="btn" onclick={retry}>Try again</button>
        <button class="btn btn--ghost" onclick={reset}>Back</button>
      {:else}
        <h1>Building your pack…</h1>
        <p class="sub">Fetching articles and tallying their links.</p>
        <p class="tally mono">drawing from Wikipedia</p>
      {/if}
    </div>
  {:else}
    <div class="reveal">
      <div class="stage">
        {#if !allOpen}
          <div class="stack-wrap">
            <div
              class="stack"
              role="button"
              tabindex="0"
              aria-label="Open the next card, {remaining.length} left"
              onclick={drawNext}
              onkeydown={onStackKey}
            >
              {#each remaining as card, i (card.id)}
                <div class="stacked" style="--i:{i}" out:fly={{ y: 220, duration: 240 }}>
                  <Card {card} faceDown />
                </div>
              {/each}
            </div>
            <p class="hint mono">{remaining.length} card{remaining.length === 1 ? '' : 's'} left · click to open</p>
          </div>
        {:else}
          <div class="done" in:scale={{ duration: 240, start: 0.96 }}>
            <span class="result mono">Best pull: <b class="rarity-{bestRarity}">{bestRarity}</b></span>
            {#if packFoil}
              <span class="result mono foil-{packFoil}">✦ {FOIL_LABEL[packFoil]} foil</span>
            {/if}
            <button class="btn" onclick={reset}>Open another</button>
          </div>
        {/if}
      </div>

      <div class="drawn">
        {#each drawn as card (card.id)}
          <div
            class="slot"
            class:pop={card.rarity === 'rare' || card.rarity === 'mythic' || (card.foil ?? 0) > 0}
            in:fly={{ y: -32, duration: 280 }}
            animate:flip={{ duration: 220 }}
          >
            <Card
              {card}
              isNew={newIds.has(card.id)}
              onclick={() => (detail = card)}
              onResolveImage={(url) => collection.setImage(card.id, url)}
            />
          </div>
        {/each}
      </div>

      {#if !allOpen && drawn.length > 0}
        <div class="actions">
          <button class="btn btn--ghost" onclick={revealRest}>Reveal the rest</button>
        </div>
      {/if}
    </div>
  {/if}
</section>

{#if detail}
  <CardDetail card={detail} onclose={() => (detail = null)} />
{/if}

<style>
  .opener {
    padding-block: clamp(40px, 10vh, 110px);
  }
  .idle,
  .waiting {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 18px;
  }
  .waiting .btn + .btn {
    margin-top: 4px;
  }
  .waiting .deck {
    animation: deck-pulse 1.5s ease-in-out infinite;
  }
  @keyframes deck-pulse {
    50% {
      opacity: 0.55;
      transform: scale(0.98);
    }
  }
  .deck {
    position: relative;
    width: 176px;
    height: 246px;
    margin-bottom: 18px;
    container-type: inline-size;
  }
  .deck--open {
    padding: 0;
    background: none;
    border: 0;
    cursor: pointer;
    transition: transform var(--dur) var(--ease);
  }
  .deck--open:hover {
    transform: translateY(-6px);
  }
  .deck--open:active {
    transform: translateY(-2px) scale(0.99);
  }
  .deck--open:hover .pane.top {
    box-shadow: 0 26px 60px rgba(0, 0, 0, 0.5);
  }
  .deck .pane {
    position: absolute;
    inset: 0;
    border-radius: var(--card-radius);
    background: linear-gradient(165deg, #c9ccd1, #a9acb2);
    border: 1px solid var(--paper-line);
  }
  .deck .pane:nth-child(1) {
    transform: rotate(-7deg) translateY(4px);
  }
  .deck .pane:nth-child(2) {
    transform: rotate(4deg);
  }
  .deck .pane.top {
    border: 0;
    overflow: hidden;
    transform: rotate(-1deg) translateY(-4px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  }
  h1 {
    font-size: clamp(30px, 5vw, 44px);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .sub {
    color: var(--text-dim);
    max-width: 46ch;
    font-size: 16px;
  }
  .tally {
    color: var(--text-faint);
    font-size: 13px;
  }

  /* --- reveal: click-through deck --- */
  .stage {
    display: grid;
    place-items: center;
    min-height: 380px;
  }
  .stack-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
  }
  .stack {
    position: relative;
    width: clamp(200px, 40vw, 244px);
    aspect-ratio: 2.5 / 3.5;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--dur) var(--ease);
  }
  .stack:hover {
    transform: translateY(-5px);
  }
  .stack:active {
    transform: scale(0.985);
  }
  .stacked {
    position: absolute;
    inset: 0;
    pointer-events: none;
    transform: translate3d(calc(var(--i) * 3px), calc(var(--i) * 4px), 0)
      rotate(calc(var(--i) * 0.5deg));
    z-index: calc(50 - var(--i));
    filter: brightness(calc(1 - var(--i) * 0.055));
  }
  .hint {
    color: var(--text-faint);
    font-size: 13px;
  }
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  /* --- opened cards, below the deck --- */
  .drawn {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: clamp(10px, 1.6vw, 20px);
    margin-top: 28px;
    min-height: 1px;
  }
  .slot {
    width: clamp(116px, 15vw, 174px);
    transition: transform var(--dur) var(--ease);
  }
  .slot.pop {
    transform: translateY(-8px) scale(1.03);
    z-index: 2;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 28px;
    min-height: 46px;
  }
  .result {
    color: var(--text-dim);
    font-size: 14px;
  }
  .result b {
    color: var(--accent);
    text-transform: capitalize;
  }
  .result.foil-1 {
    color: var(--foil-1);
  }
  .result.foil-2 {
    color: var(--foil-2);
  }
  .result.foil-3 {
    color: var(--foil-3);
    text-shadow: 0 0 10px color-mix(in srgb, var(--foil-3) 55%, transparent);
  }

  @media (max-width: 520px) {
    .stage {
      min-height: 320px;
    }
    .slot {
      width: clamp(112px, 40vw, 150px);
    }
  }
</style>
