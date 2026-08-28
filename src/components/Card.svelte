<script lang="ts">
  import type { Card } from '../lib/types';
  import RarityBadge from './RarityBadge.svelte';
  import Foil from './Foil.svelte';

  let {
    card,
    faceDown = false,
    dupCount = 0,
    isNew = false,
    onclick
  }: {
    card: Card;
    faceDown?: boolean;
    dupCount?: number;
    isNew?: boolean;
    onclick?: () => void;
  } = $props();

  let imgFailed = $state(false);
  $effect(() => {
    // reset when the card changes
    card.id;
    imgFailed = false;
  });

  const showImage = $derived(!!card.image && !imgFailed);
  const foiled = $derived(card.rarity === 'rare' || card.rarity === 'mythic');
  const initials = $derived(
    card.title
      .replace(/\(.*?\)/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
  );
</script>

<div class="card rarity-{card.rarity}">
  <button
    class="flipper"
    class:faceDown
    class:foiled
    type="button"
    aria-label={faceDown ? 'Unrevealed card' : `${card.title}, ${card.rarity}`}
    {onclick}
    disabled={!onclick}
  >
    <div class="inner">
      <div class="face front">
        <div class="art">
          {#if showImage}
            <img src={card.image} alt="" loading="lazy" onerror={() => (imgFailed = true)} />
          {:else}
            <div class="art-fallback"><span>{initials}</span></div>
          {/if}
          <div class="art-fade"></div>
          {#if dupCount > 1}<span class="dup mono">×{dupCount}</span>{/if}
          {#if isNew}<span class="new">NEW</span>{/if}
        </div>

        <div class="body">
          <h3 class="title">{card.title}</h3>
          <div class="rule"></div>
          <div class="stats mono">
            <span class="stat"><b>STR</b>{card.strength}</span>
            <span class="stat"><b>DEF</b>{card.defence}</span>
            <RarityBadge rarity={card.rarity} size="sm" />
          </div>
        </div>

        {#if foiled}<Foil rarity={card.rarity} />{/if}
      </div>

      <div class="face back">
        <div class="back-mark">W</div>
      </div>
    </div>
  </button>
</div>

<style>
  .card {
    container-type: inline-size;
    width: 100%;
  }
  .flipper {
    width: 100%;
    aspect-ratio: 2.5 / 3.5;
    perspective: 1200px;
    display: block;
    padding: 0;
    background: none;
  }
  .flipper:disabled {
    cursor: default;
  }
  .inner {
    position: relative;
    width: 100%;
    height: 100%;
    transition: transform 560ms var(--ease);
    transform-style: preserve-3d;
  }
  .flipper.faceDown .inner {
    transform: rotateY(180deg);
  }
  .flipper:not(:disabled):hover .inner {
    transform: translateY(-4px);
  }
  .flipper.faceDown:not(:disabled):hover .inner {
    transform: rotateY(180deg) translateY(-4px);
  }

  .face {
    position: absolute;
    inset: 0;
    border-radius: var(--card-radius);
    backface-visibility: hidden;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .flipper.foiled .front {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent),
      0 8px 30px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .front {
    display: flex;
    flex-direction: column;
  }

  .art {
    position: relative;
    flex: 1 1 56%;
    min-height: 0;
    background: var(--surface-2);
  }
  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .art-fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    background: radial-gradient(
      120% 120% at 50% 0%,
      color-mix(in srgb, var(--accent) 22%, var(--surface-2)),
      var(--surface-2)
    );
  }
  .art-fallback span {
    font-size: clamp(28px, 12cqw, 56px);
    font-weight: 700;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, var(--accent) 75%, var(--text));
  }
  .art-fade {
    position: absolute;
    inset: auto 0 0 0;
    height: 40%;
    background: linear-gradient(transparent, color-mix(in srgb, var(--surface) 92%, transparent));
  }

  .dup,
  .new {
    position: absolute;
    top: 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 3px 6px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(4px);
  }
  .dup {
    right: 8px;
    color: var(--text);
  }
  .new {
    left: 8px;
    color: var(--bg);
    background: var(--accent);
  }

  .body {
    position: relative;
    padding: 10px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .title {
    font-size: clamp(12px, 5.2cqw, 17px);
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.01em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .rule {
    height: 1px;
    background: var(--line);
  }
  .stats {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
  }
  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    color: var(--text);
  }
  .stat b {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--text-faint);
  }
  .stats :global(.badge) {
    margin-left: auto;
  }

  .back {
    transform: rotateY(180deg);
    display: grid;
    place-items: center;
    background: repeating-linear-gradient(
      -45deg,
      var(--surface),
      var(--surface) 8px,
      var(--surface-2) 8px,
      var(--surface-2) 16px
    );
  }
  .back-mark {
    width: 44%;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 50%;
    font-size: clamp(20px, 10cqw, 40px);
    font-weight: 700;
    color: var(--text-dim);
  }
</style>
