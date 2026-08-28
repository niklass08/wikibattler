<script lang="ts">
  import type { Card, FoilTier } from '../lib/types';
  import { RARITY_GLYPH, RARITY_LABEL } from '../lib/types';
  import { backupImage } from '../lib/wiki';
  import Foil from './Foil.svelte';
  import CardBack from './CardBack.svelte';

  let {
    card,
    faceDown = false,
    dupCount = 0,
    isNew = false,
    onclick,
    onResolveImage
  }: {
    card: Card;
    faceDown?: boolean;
    dupCount?: number;
    isNew?: boolean;
    onclick?: () => void;
    /** Called with a backup art URL found for a card that had none. */
    onResolveImage?: (url: string) => void;
  } = $props();

  let failedSrc = $state<string | null>(null);
  let resolved = $state<string | null>(null);
  let triedTitle = ''; // guard: resolve a given title at most once per instance

  // A revealed card with no art of its own: look one up and hand it back so the
  // caller can persist it. Runs client-side only ($effect is skipped in SSR).
  $effect(() => {
    const title = card.title;
    if (faceDown || card.image || title === triedTitle) return;
    triedTitle = title;
    resolved = null;
    backupImage(title).then((url) => {
      if (url && card.title === title) {
        resolved = url;
        onResolveImage?.(url);
      }
    });
  });

  const src = $derived(card.image ?? resolved);
  const showImage = $derived(!!src && src !== failedSrc);
  // Foil is a rarity-independent finish rolled per pack. Suppress it while
  // face-down — a hidden card must look identical whatever it holds, and the
  // foil layers animate on their own compositing layer / bleed past
  // backface-visibility, which would leak the pull before the reveal.
  const foilTier = $derived<FoilTier>(faceDown ? 0 : (card.foil ?? 0));
  const foiled = $derived(foilTier > 0);
  const initials = $derived(
    card.title
      .replace(/\(.*?\)/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
  );
  // deterministic hue so imageless cards each get their own tinted field
  const fallbackHue = $derived(
    Math.abs([...card.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 360
  );
</script>

<div class="card rarity-{card.rarity}">
  <button
    class="flipper"
    class:faceDown
    class:foiled
    data-foil={foiled ? foilTier : undefined}
    type="button"
    aria-label={faceDown ? 'Unrevealed card' : `${card.title}, ${card.rarity}`}
    {onclick}
    disabled={!onclick}
  >
    <div class="inner">
      <div class="face front">
        <div class="art">
          {#if showImage}
            <img {src} alt="" loading="lazy" onerror={() => (failedSrc = src)} />
          {:else}
            <div class="art-fallback" style="--fh:{fallbackHue}"><span>{initials}</span></div>
          {/if}
          <div class="art-fade"></div>
          {#if !faceDown}
            <span
              class="glyph rarity-{card.rarity}"
              title={RARITY_LABEL[card.rarity]}
              aria-hidden="true">{RARITY_GLYPH[card.rarity]}</span>
            {#if isNew}<span class="new">NEW</span>{/if}
            {#if dupCount > 1}<span class="dup mono" class:stacked={isNew}>×{dupCount}</span>{/if}
          {/if}
        </div>

        <div class="body">
          <h3 class="title">{card.title}</h3>
          <div class="rule"></div>
          <div class="stats mono">
            <span class="stat"><b>STR</b>{card.strength}</span>
            <span class="stat"><b>DEF</b>{card.defence}</span>
          </div>
        </div>

        {#if foiled}<Foil tier={foilTier as Exclude<FoilTier, 0>} />{/if}
      </div>

      <div class="face back">
        <CardBack />
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
  /* foil finish — rarity-independent, escalating with tier */
  .flipper.foiled .front {
    border-color: color-mix(in srgb, var(--foil-2) 40%, var(--line));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--foil-1) 20%, transparent),
      0 8px 30px color-mix(in srgb, var(--foil-2) 14%, transparent);
  }
  .flipper[data-foil='2'] .front {
    border-color: color-mix(in srgb, var(--foil-1) 46%, var(--line));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--foil-1) 30%, transparent),
      0 10px 36px color-mix(in srgb, var(--foil-2) 22%, transparent);
  }
  .flipper[data-foil='3'] .front {
    border-color: color-mix(in srgb, var(--foil-5) 52%, var(--line));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--foil-3) 34%, transparent),
      0 12px 44px color-mix(in srgb, var(--foil-5) 26%, transparent),
      0 0 22px color-mix(in srgb, var(--foil-1) 22%, transparent);
    animation: card-foil-pulse 3s ease-in-out infinite;
  }
  @keyframes card-foil-pulse {
    50% {
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--foil-3) 45%, transparent),
        0 14px 52px color-mix(in srgb, var(--foil-5) 36%, transparent),
        0 0 32px color-mix(in srgb, var(--foil-1) 32%, transparent);
    }
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
    background:
      radial-gradient(130% 95% at 12% 8%, hsl(var(--fh, 220) 42% 26% / 0.9), transparent 62%),
      radial-gradient(130% 95% at 90% 96%, hsl(calc(var(--fh, 220) + 50) 40% 22% / 0.85), transparent 60%),
      var(--surface-2);
  }
  .art-fallback span {
    font-size: clamp(28px, 12cqw, 56px);
    font-weight: 700;
    letter-spacing: 0.04em;
    color: hsl(var(--fh, 220) 55% 82%);
    text-shadow: 0 2px 18px hsl(var(--fh, 220) 60% 20% / 0.6);
  }
  .art-fade {
    position: absolute;
    inset: auto 0 0 0;
    height: 40%;
    background: linear-gradient(transparent, color-mix(in srgb, var(--surface) 92%, transparent));
  }

  .glyph,
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
  .new {
    right: 8px;
    color: var(--bg);
    background: var(--accent);
  }
  .dup {
    right: 8px;
    color: var(--text);
  }
  .dup.stacked {
    top: 30px;
  }
  .glyph {
    left: 8px;
    display: grid;
    place-items: center;
    width: clamp(20px, 8cqw, 26px);
    height: clamp(20px, 8cqw, 26px);
    padding: 0;
    overflow: hidden;
    isolation: isolate;
    font-size: clamp(11px, 4.5cqw, 15px);
    line-height: 1;
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  }

  /* common — quiet, just a mark */
  .glyph.rarity-common {
    color: color-mix(in srgb, var(--common) 70%, var(--text));
    border-color: color-mix(in srgb, var(--common) 26%, transparent);
  }

  /* uncommon — a soft inner light */
  .glyph.rarity-uncommon {
    border-color: color-mix(in srgb, var(--uncommon) 55%, transparent);
    text-shadow: 0 0 6px color-mix(in srgb, var(--uncommon) 55%, transparent);
    box-shadow: inset 0 0 9px color-mix(in srgb, var(--uncommon) 22%, transparent);
  }

  /* rare — gradient fill, outer glow, a shine that sweeps past */
  .glyph.rarity-rare {
    border-color: color-mix(in srgb, var(--rare) 70%, transparent);
    background: linear-gradient(
      150deg,
      color-mix(in srgb, var(--rare) 32%, transparent),
      color-mix(in srgb, var(--bg) 74%, transparent) 60%
    );
    text-shadow: 0 0 9px color-mix(in srgb, var(--rare) 80%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--rare) 22%, transparent),
      0 0 13px color-mix(in srgb, var(--rare) 38%, transparent);
  }
  .glyph.rarity-rare::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      115deg,
      transparent 38%,
      color-mix(in srgb, #fff 60%, transparent) 50%,
      transparent 62%
    );
    transform: translateX(-130%);
    animation: glyph-shine 3.8s ease-in-out infinite;
  }

  /* mythic — a living gold / violet aura */
  .glyph.rarity-mythic {
    color: var(--mythic-2);
    border-color: color-mix(in srgb, var(--mythic) 60%, transparent);
    text-shadow:
      0 0 8px color-mix(in srgb, var(--mythic-2) 85%, transparent),
      0 0 16px color-mix(in srgb, var(--mythic) 60%, transparent);
    box-shadow:
      0 0 12px color-mix(in srgb, var(--mythic) 55%, transparent),
      0 0 26px color-mix(in srgb, var(--mythic-2) 28%, transparent);
    animation: glyph-throb 2.6s ease-in-out infinite;
  }
  .glyph.rarity-mythic::after {
    content: '';
    position: absolute;
    inset: -60%;
    background: conic-gradient(
      from 0deg,
      transparent,
      color-mix(in srgb, var(--mythic-2) 70%, transparent),
      color-mix(in srgb, var(--mythic) 70%, transparent),
      transparent 55%
    );
    mix-blend-mode: screen;
    animation: glyph-spin 3.4s linear infinite;
  }

  @keyframes glyph-shine {
    0%,
    62% {
      transform: translateX(-130%);
    }
    80%,
    100% {
      transform: translateX(130%);
    }
  }
  @keyframes glyph-spin {
    to {
      transform: rotate(1turn);
    }
  }
  @keyframes glyph-throb {
    0%,
    100% {
      box-shadow:
        0 0 12px color-mix(in srgb, var(--mythic) 55%, transparent),
        0 0 26px color-mix(in srgb, var(--mythic-2) 28%, transparent);
    }
    50% {
      box-shadow:
        0 0 18px color-mix(in srgb, var(--mythic) 78%, transparent),
        0 0 38px color-mix(in srgb, var(--mythic-2) 44%, transparent);
    }
  }

  .body {
    position: relative;
    padding: 12px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .title {
    font-size: clamp(13px, 5.4cqw, 19px);
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
    justify-content: center;
    gap: 16px;
    font-size: clamp(12px, 4.6cqw, 14px);
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

  .back {
    transform: rotateY(180deg);
    background: var(--paper-2);
    border-color: var(--paper-line);
  }
</style>
