<script lang="ts">
  import { tick } from 'svelte';
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { collection, packsOpened } from '../lib/collection';
  import { take, retry, status as queueStatus, MAX_PREFETCH } from '../lib/packQueue';
  import { isGodPack } from '../lib/foil';
  import { FOIL_LABEL, type Card as CardT, type FoilTier } from '../lib/types';
  import Card from './Card.svelte';
  import CardBack from './CardBack.svelte';
  import CardDetail from './CardDetail.svelte';

  const NEXT_DECK = [0, 1, 2, 3, 4];

  let pack = $state<CardT[]>([]);
  let opened = $state(0);
  let newIds = $state<Set<number>>(new Set());
  let detail = $state<CardT | null>(null);
  /** set when "open" was clicked but the queue had nothing ready yet */
  let pendingOpen = $state(false);
  let sectionEl = $state<HTMLElement>();
  let drawnEl = $state<HTMLElement>();

  const hasPack = $derived(pack.length > 0);
  const remaining = $derived(pack.slice(opened));
  // Draw order in the DOM; CSS places the newest card at the right on desktop
  // and at the top on mobile (see .drawn).
  const drawn = $derived(pack.slice(0, opened));
  const allOpen = $derived(hasPack && opened >= pack.length);
  const bestRarity = $derived(rank(drawn));
  const packFoil = $derived<FoilTier>(
    pack.reduce<FoilTier>((m, c) => (((c.foil ?? 0) > m ? c.foil : m) as FoilTier), 0)
  );
  const godPack = $derived(isGodPack(pack));
  const hasNegated = $derived(pack.some((c) => c.negated));

  function rank(cards: CardT[]): string {
    const order = ['common', 'uncommon', 'rare', 'mythic'];
    return cards.reduce((best, c) => (order.indexOf(c.rarity) > order.indexOf(best) ? c.rarity : best), 'common');
  }

  function startReveal(cards: CardT[]) {
    pack = cards;
    opened = 0;
    newIds = collection.addCards(cards);
    packsOpened.increment();
    pendingOpen = false;
    void drawNext(); // flip the first card straight away
  }

  /** One gesture for the whole loop: deal the next pack (queue permitting). */
  function openPack() {
    const ready = take();
    if (ready) startReveal(ready);
    else pendingOpen = true;
  }

  // Resolve a pending open once the background queue catches up.
  $effect(() => {
    if (!pendingOpen) return;
    if ($queueStatus.ready > 0) {
      const ready = take();
      if (ready) startReveal(ready);
    }
  });

  function retryOpen() {
    retry();
    pendingOpen = true;
  }

  async function drawNext() {
    if (opened >= pack.length) return;
    opened += 1;
    // keep the newest card in view on small screens; the deck area holds its
    // size when the pack finishes, so opening the last card causes no reflow
    if (allOpen) return;
    await tick();
    drawnEl?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function revealRest() {
    opened = pack.length;
    await tick();
    sectionEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function onStackKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      drawNext();
    }
  }
</script>

<section class="opener wrap" bind:this={sectionEl}>
  {#if !hasPack && !pendingOpen && !$queueStatus.error}
    <div class="idle" in:scale={{ duration: 300, start: 0.94 }}>
      <button class="deck deck--open" type="button" onclick={openPack} aria-label="Open pack">
        <span class="pane"></span><span class="pane"></span>
        <span class="pane top"><CardBack /></span>
      </button>
      <h1>Open a pack</h1>
      <p class="sub">
        Seven cards drawn live from Wikipedia. Four common, two uncommon, a
        guaranteed rare — and every card rolls to upgrade, the deeper the better.
      </p>
      <button class="btn" onclick={openPack}>Open pack</button>
      <p class="tally mono">
        {$packsOpened} opened
        {#if $queueStatus.ready < MAX_PREFETCH && !$queueStatus.error}
          · {$queueStatus.ready}/{MAX_PREFETCH} ready
        {/if}
      </p>
    </div>
  {:else if !hasPack}
    <div class="waiting" in:scale={{ duration: 300, start: 0.94 }}>
      <div class="deck" aria-hidden="true">
        <span class="pane"></span><span class="pane"></span>
        <span class="pane top"><CardBack /></span>
      </div>
      {#if $queueStatus.error}
        <h1>Couldn't reach Wikipedia</h1>
        <p class="sub">{$queueStatus.error}</p>
        <button class="btn" onclick={retryOpen}>Try again</button>
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
            {#if godPack && opened >= 2}
              <p class="god" in:scale={{ duration: 260, start: 0.9 }}>✦ GOD PACK ✦</p>
            {/if}
          </div>
        {:else}
          <div class="stack-wrap" in:scale={{ duration: 240, start: 0.96 }}>
            <button
              class="stack deck--next"
              type="button"
              onclick={openPack}
              disabled={pendingOpen}
              aria-label="Open another pack"
            >
              {#each NEXT_DECK as i (i)}
                <div class="stacked" style="--i:{i}"><CardBack /></div>
              {/each}
            </button>
            <p class="hint mono">
              {#if pendingOpen && $queueStatus.error}
                couldn't reach Wikipedia ·
                <button class="link" type="button" onclick={retryOpen}>retry</button>
              {:else if pendingOpen}
                stocking the next pack…
              {:else if godPack}
                <span class="god">✦ god pack</span> · click for another
              {:else}
                best pull <b class="rarity-{bestRarity}">{bestRarity}</b>{#if packFoil} ·
                  <span class="foil-{packFoil}">{FOIL_LABEL[packFoil]} foil</span>{/if}{#if hasNegated}
                  · <span class="negated">negated</span>{/if} ·
                click for another
              {/if}
            </p>
          </div>
        {/if}
      </div>

      <div class="drawn" bind:this={drawnEl}>
        {#each drawn as card (card.id)}
          <div
            class="slot"
            class:pop={card.rarity === 'rare' ||
              card.rarity === 'mythic' ||
              (card.foil ?? 0) > 0 ||
              card.negated}
            in:fly={{ y: -32, duration: 280 }}
            out:fly={{ y: 18, duration: 130 }}
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
  /* tall enough to hold the deck + hint + (god) banner, so swapping in the
     smaller summary when the pack finishes never shifts the card row below */
  .stage {
    display: grid;
    place-items: center;
    min-height: 440px;
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
    padding: 0;
    container-type: inline-size;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--dur) var(--ease);
  }
  .stack:hover {
    transform: translateY(-5px);
  }
  .stack:active {
    transform: scale(0.985);
  }
  /* "open another" deck shown when a pack is done — card backs, not <Card>s */
  .deck--next:disabled {
    cursor: default;
  }
  .deck--next .stacked {
    border-radius: var(--card-radius);
    overflow: hidden;
  }
  .stacked {
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* fan upward from a bottom-anchored front card, so the deck never overlaps
       the hint / list below it */
    transform-origin: bottom center;
    transform: translateY(calc(var(--i) * -1.5px)) rotate(calc(var(--i) * -0.5deg));
    z-index: calc(50 - var(--i));
    filter: brightness(calc(1 - var(--i) * 0.05));
  }
  .hint {
    position: relative;
    z-index: 1;
    color: var(--text-faint);
    font-size: 13px;
    text-align: center;
    max-width: 34ch;
    line-height: 1.7;
  }
  .hint b {
    color: var(--accent);
    text-transform: capitalize;
  }
  .hint .foil-1 {
    color: var(--foil-1);
  }
  .hint .foil-2 {
    color: var(--foil-2);
  }
  .hint .foil-3 {
    color: var(--foil-3);
  }
  .hint .negated {
    color: var(--bg);
    background: var(--text);
    padding: 0 5px;
    border-radius: 4px;
  }
  .link {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
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
  .god {
    position: relative;
    z-index: 1;
    font-family: var(--font-mono);
    font-weight: 700;
    letter-spacing: 0.32em;
    font-size: clamp(13px, 3.4vw, 17px);
    text-transform: uppercase;
    background: linear-gradient(
      90deg,
      var(--foil-5),
      var(--foil-2),
      var(--foil-1),
      var(--foil-4),
      var(--foil-3),
      var(--foil-5)
    );
    background-size: 300% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: god-hue 4s linear infinite;
  }
  .hint .god {
    font-size: inherit;
    letter-spacing: 0.14em;
  }
  @keyframes god-hue {
    to {
      background-position: 300% 0;
    }
  }

  @media (max-width: 600px) {
    .opener {
      padding-block: clamp(16px, 4vh, 36px);
    }
    .stage {
      min-height: 380px;
    }
    .stack {
      width: min(56vw, 210px);
    }
    .stack-wrap {
      gap: 18px;
    }
    .drawn {
      margin-top: 16px;
      gap: 10px;
      /* newest card at the top on a phone */
      flex-direction: row-reverse;
      flex-wrap: wrap-reverse;
    }
    .slot {
      width: min(43vw, 150px);
    }
    .actions {
      margin-top: 16px;
    }
  }
</style>
