<!-- Shared card back: a Wikipedia throwback — paper greys, a globe + serif W,
     faint ruled "article" lines. Fills its (position:relative) parent. Root is a
     <span> so it stays valid inside the deck <button>. An optional `accent`
     colour-codes the back for a thematic pack (border + glow + corner icon). -->
<script lang="ts">
  let { accent, icon }: { accent?: string; icon?: string } = $props();
</script>

<span class="cardback" class:themed={!!accent} style:--pack={accent} aria-hidden="true">
  <span class="emblem">
    <svg class="globe" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" />
      <ellipse cx="50" cy="50" rx="16" ry="46" />
      <ellipse cx="50" cy="50" rx="33" ry="46" />
      <line x1="8" y1="31" x2="92" y2="31" />
      <line x1="4" y1="50" x2="96" y2="50" />
      <line x1="8" y1="69" x2="92" y2="69" />
    </svg>
    <span class="w">W</span>
  </span>
  <span class="tag">The Free Card Game</span>
  {#if accent && icon}<span class="badge">{icon}</span>{/if}
</span>

<style>
  .cardback {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7cqw;
    color: var(--paper-ink);
    background:
      radial-gradient(120% 78% at 50% 0%, #e7e8eb, transparent 72%),
      linear-gradient(165deg, #d6d8dc 0%, #c0c3c8 55%, #adb0b6 100%);
    border: 1px solid var(--paper-line);
  }
  /* thematic pack — same paper back, tinted */
  .cardback.themed {
    border-color: var(--pack);
    box-shadow:
      inset 0 0 0 2px color-mix(in srgb, var(--pack) 60%, transparent),
      0 0 22px -4px var(--pack);
  }
  .cardback.themed::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(130% 60% at 50% 100%, color-mix(in srgb, var(--pack) 32%, transparent), transparent 70%);
    mix-blend-mode: multiply;
  }
  .badge {
    position: absolute;
    top: 6cqw;
    right: 6cqw;
    font-size: 9cqw;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.4));
  }
  /* faint ruled lines, like the text of an article */
  .cardback::before {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      180deg,
      transparent 0 5.6%,
      color-mix(in srgb, var(--paper-ink) 8%, transparent) 5.6%,
      color-mix(in srgb, var(--paper-ink) 8%, transparent) calc(5.6% + 1px)
    );
    -webkit-mask: linear-gradient(180deg, transparent, #000 16%, #000 84%, transparent);
    mask: linear-gradient(180deg, transparent, #000 16%, #000 84%, transparent);
  }

  .emblem {
    position: relative;
    width: 46cqw;
    height: 46cqw;
    display: grid;
    place-items: center;
  }
  .globe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: color-mix(in srgb, var(--paper-ink) 40%, transparent);
    stroke-width: 1.3;
  }
  .w {
    position: relative;
    font-family: Georgia, 'Times New Roman', 'Linux Libertine', serif;
    font-size: 25cqw;
    line-height: 1;
    color: var(--paper-ink);
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
  }
  .tag {
    position: relative;
    font-size: 5.2cqw;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    font-weight: 600;
    color: color-mix(in srgb, var(--paper-ink) 78%, transparent);
  }

  /* on the smallest reveal cards, drop the tagline */
  @container (max-width: 128px) {
    .tag {
      display: none;
    }
    .cardback {
      gap: 0;
    }
  }
</style>
