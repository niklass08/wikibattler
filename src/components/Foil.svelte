<script lang="ts">
  import type { FoilTier } from '../lib/types';

  let { tier }: { tier: Exclude<FoilTier, 0> } = $props();

  let x = $state(50);
  let y = $state(50);
  let active = $state(false);

  function onMove(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    x = ((e.clientX - r.left) / r.width) * 100;
    y = ((e.clientY - r.top) / r.height) * 100;
    active = true;
  }

  // fixed sparkle field so tier 3 doesn't reshuffle every render
  const SPARKS = [
    [18, 20],
    [74, 14],
    [42, 40],
    [88, 56],
    [12, 68],
    [60, 84],
    [30, 92],
    [92, 30]
  ];
</script>

<div
  class="foil tier-{tier}"
  class:active
  role="presentation"
  style="--x:{x}%; --y:{y}%"
  onpointermove={onMove}
  onpointerleave={() => (active = false)}
>
  <!-- tier 1 baseline: the old mythic shimmer -->
  <div class="spin"></div>

  {#if tier >= 2}
    <div class="holo"></div>
    <div class="sweep"></div>
  {/if}

  {#if tier >= 3}
    <div class="rainbow"></div>
    <div class="sparks">
      {#each SPARKS as [sx, sy], i (i)}
        <span style="--sx:{sx}%; --sy:{sy}%; animation-delay:{i * 0.37}s"></span>
      {/each}
    </div>
  {/if}

  <div class="sheen"></div>
</div>

<style>
  .foil {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: auto;
    overflow: hidden;
    isolation: isolate;
  }
  .foil > * {
    position: absolute;
    pointer-events: none;
  }

  /* --- baseline: slow rotating conic sheen (all tiers) --- */
  .spin {
    inset: -60%;
    background: conic-gradient(
      from 0deg,
      transparent,
      color-mix(in srgb, var(--foil-1) 28%, transparent),
      color-mix(in srgb, var(--foil-2) 28%, transparent),
      color-mix(in srgb, var(--foil-3) 22%, transparent),
      transparent 62%
    );
    mix-blend-mode: screen;
    opacity: 0.5;
    animation: foil-spin 6s linear infinite;
  }
  .tier-2 .spin {
    opacity: 0.72;
    animation-duration: 5s;
  }
  .tier-3 .spin {
    opacity: 0.9;
    animation-duration: 4s;
  }

  /* --- pointer-tracked highlight (all tiers) --- */
  .sheen {
    inset: -40%;
    opacity: 0;
    transition: opacity var(--dur) var(--ease);
    background: radial-gradient(
      circle at var(--x) var(--y),
      color-mix(in srgb, #fff 55%, transparent),
      transparent 42%
    );
    mix-blend-mode: screen;
  }
  .foil.active .sheen {
    opacity: 1;
  }
  .tier-2 .sheen,
  .tier-3 .sheen {
    background: radial-gradient(
      circle at var(--x) var(--y),
      color-mix(in srgb, var(--foil-1) 55%, transparent),
      color-mix(in srgb, var(--foil-5) 38%, transparent) 26%,
      transparent 46%
    );
  }

  /* --- tier 2: holographic bands that shift with tilt + a travelling shine --- */
  .holo {
    inset: 0;
    background: repeating-linear-gradient(
      115deg,
      color-mix(in srgb, var(--foil-1) 20%, transparent) 0 7%,
      color-mix(in srgb, var(--foil-2) 20%, transparent) 7% 14%,
      color-mix(in srgb, var(--foil-3) 18%, transparent) 14% 21%,
      color-mix(in srgb, var(--foil-4) 18%, transparent) 21% 28%,
      transparent 28% 44%
    );
    background-size: 240% 240%;
    background-position: calc(var(--x) * -1) var(--y);
    mix-blend-mode: screen;
    opacity: 0.5;
  }
  .tier-3 .holo {
    opacity: 0.62;
  }

  .sweep {
    inset: 0;
    background: linear-gradient(
      115deg,
      transparent 40%,
      color-mix(in srgb, #fff 72%, transparent) 47%,
      color-mix(in srgb, var(--foil-1) 55%, transparent) 50%,
      color-mix(in srgb, var(--foil-5) 45%, transparent) 53%,
      transparent 60%
    );
    mix-blend-mode: screen;
    transform: translateX(-160%);
    animation: foil-sweep 4.5s ease-in-out infinite;
  }
  .tier-3 .sweep {
    animation-duration: 3.4s;
  }

  /* --- tier 3: hue-cycling rainbow wash + sparkles --- */
  .rainbow {
    inset: 0;
    background: linear-gradient(
      60deg,
      var(--foil-5),
      var(--foil-2),
      var(--foil-1),
      var(--foil-4),
      var(--foil-3),
      var(--foil-5)
    );
    background-size: 300% 300%;
    mix-blend-mode: screen;
    opacity: 0.3;
    animation: foil-hue 6s linear infinite;
  }
  .sparks {
    inset: 0;
  }
  .sparks span {
    position: absolute;
    left: var(--sx);
    top: var(--sy);
    width: 7px;
    height: 7px;
    margin: -3.5px 0 0 -3.5px;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      #fff,
      color-mix(in srgb, var(--foil-1) 60%, transparent) 45%,
      transparent 70%
    );
    opacity: 0;
    animation: foil-spark 2.6s ease-in-out infinite;
  }

  @keyframes foil-spin {
    to {
      transform: rotate(1turn);
    }
  }
  @keyframes foil-sweep {
    0%,
    55% {
      transform: translateX(-160%);
    }
    78%,
    100% {
      transform: translateX(160%);
    }
  }
  @keyframes foil-hue {
    to {
      background-position: 300% 0;
    }
  }
  @keyframes foil-spark {
    0%,
    100% {
      opacity: 0;
      transform: scale(0.4);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
