<script lang="ts">
  import type { Card } from '../../lib/types';

  let {
    card,
    role = 'living',
    down = false
  }: { card: Card; role?: 'living' | 'abstract'; down?: boolean } = $props();

  const initials = $derived(
    card.title
      .replace(/\(.*?\)/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
  );
  const hue = $derived(
    Math.abs([...card.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 360
  );
</script>

<figure class="mini rarity-{card.rarity}" class:down class:foil={(card.foil ?? 0) > 0} title={card.title}>
  <div class="art">
    {#if card.image}
      <img src={card.image} alt="" loading="lazy" />
    {:else}
      <div class="fallback" style="--fh:{hue}"><span>{initials}</span></div>
    {/if}
    <span class="role" class:field={role === 'abstract'}>{role === 'living' ? '⚔' : '✦'}</span>
  </div>
  <figcaption>{card.title}</figcaption>
</figure>

<style>
  .mini {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface-2);
    border: 1px solid color-mix(in srgb, var(--accent, var(--line)) 55%, var(--line));
    box-shadow:
      0 1px 3px rgb(0 0 0 / 0.4),
      0 0 0 1px color-mix(in srgb, var(--accent, transparent) 20%, transparent),
      0 0 14px color-mix(in srgb, var(--accent, transparent) 22%, transparent);
    transition:
      transform 220ms var(--ease),
      box-shadow 220ms var(--ease),
      filter 220ms var(--ease);
  }
  .art {
    position: relative;
    aspect-ratio: 3 / 4;
    background: #000;
  }
  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .fallback {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      160deg,
      hsl(var(--fh) 45% 24%),
      hsl(calc(var(--fh) + 40) 40% 12%)
    );
  }
  .fallback span {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: clamp(11px, 3.4vw, 17px);
    color: hsl(var(--fh) 30% 82%);
    letter-spacing: 0.04em;
  }
  .role {
    position: absolute;
    top: 3px;
    left: 3px;
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 4px;
    font-size: 9px;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    color: var(--mythic-2);
    backdrop-filter: blur(2px);
  }
  .role.field {
    color: var(--rare);
  }
  figcaption {
    padding: 3px 4px;
    font-size: 9px;
    line-height: 1.25;
    text-align: center;
    color: var(--text-dim);
    background: var(--surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .foil::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      115deg,
      transparent 30%,
      color-mix(in srgb, var(--foil-1) 40%, transparent) 45%,
      color-mix(in srgb, var(--foil-2) 40%, transparent) 55%,
      transparent 70%
    );
    mix-blend-mode: screen;
    pointer-events: none;
  }
  .down {
    filter: grayscale(0.7) brightness(0.6);
    opacity: 0.7;
  }
</style>
