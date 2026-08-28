<script lang="ts">
  import type { Rarity } from '../lib/types';

  let { rarity }: { rarity: Rarity } = $props();

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
</script>

<div
  class="foil rarity-{rarity}"
  class:active
  role="presentation"
  style="--x:{x}%; --y:{y}%"
  onpointermove={onMove}
  onpointerleave={() => (active = false)}
>
  <div class="sheen"></div>
  {#if rarity === 'mythic'}<div class="shimmer"></div>{/if}
</div>

<style>
  .foil {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: auto;
    overflow: hidden;
  }
  .sheen {
    position: absolute;
    inset: -40%;
    opacity: 0;
    transition: opacity var(--dur) var(--ease);
    background: radial-gradient(
      circle at var(--x) var(--y),
      color-mix(in srgb, var(--accent) 45%, transparent),
      transparent 45%
    );
    mix-blend-mode: screen;
  }
  .foil.active .sheen {
    opacity: 1;
  }
  .shimmer {
    position: absolute;
    inset: 0;
    background: conic-gradient(
      from 0deg at var(--x) var(--y),
      transparent,
      color-mix(in srgb, var(--mythic) 30%, transparent),
      color-mix(in srgb, var(--mythic-2) 30%, transparent),
      transparent 60%
    );
    mix-blend-mode: screen;
    opacity: 0.5;
    animation: spin 6s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .shimmer {
      animation: none;
    }
  }
</style>
