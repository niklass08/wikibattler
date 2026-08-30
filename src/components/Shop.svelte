<script lang="ts">
  import { TAGS } from '../lib/tags';
  import { THEMES } from '../lib/themes';
  import { THEMATIC_PACK_PRICE } from '../lib/economy';
  import { knowledge, ownedPacks, buyPacks } from '../lib/shop';
  import { view } from '../stores/view';

  const price1 = THEMATIC_PACK_PRICE;
  const price5 = THEMATIC_PACK_PRICE * 5;

  let flash = $state<string | null>(null);
  function buy(t: (typeof TAGS)[number], qty: number) {
    if (buyPacks(t, qty)) {
      flash = `+${qty} ${THEMES[t].label} pack${qty === 1 ? '' : 's'}`;
      setTimeout(() => (flash = null), 2200);
    }
  }
</script>

<section class="shop wrap">
  <header class="head">
    <div>
      <h1>Shop</h1>
      <p class="sub">
        Thematic packs draw all seven cards from one theme, in the same 4·2·1
        rarity mix as a normal pack. Buy with <b>knowledge</b> — earned by
        disenchanting cards in your
        <button class="link" onclick={() => view.set('collection')}>collection</button>.
      </p>
    </div>
    <div class="wallet mono">📖 {$knowledge}<span>knowledge</span></div>
  </header>

  {#if flash}<p class="flash">{flash} added</p>{/if}

  <div class="grid">
    {#each TAGS as t (t)}
      {@const held = $ownedPacks[t] ?? 0}
      <article class="tile" style:--accent={THEMES[t].color}>
        <div class="face">
          <span class="ic">{THEMES[t].icon}</span>
          <h2>{THEMES[t].label}</h2>
          {#if held > 0}<span class="held mono">held ×{held}</span>{/if}
        </div>
        <div class="buy">
          <button disabled={$knowledge < price1} onclick={() => buy(t, 1)}>
            Buy 1 · <span class="mono">📖{price1}</span>
          </button>
          <button disabled={$knowledge < price5} onclick={() => buy(t, 5)}>
            Buy 5 · <span class="mono">📖{price5}</span>
          </button>
        </div>
      </article>
    {/each}
  </div>

  <p class="foot">
    Pick which pack to open from the selector on the <button class="link" onclick={() => view.set('open')}>Open</button> screen.
  </p>
</section>

<style>
  .shop {
    padding-block: clamp(28px, 6vh, 64px);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    margin-bottom: 22px;
  }
  h1 {
    font-size: clamp(26px, 4vw, 40px);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .sub {
    color: var(--text-dim);
    font-size: 14px;
    margin-top: 8px;
    max-width: 60ch;
    line-height: 1.6;
  }
  .sub b {
    color: var(--text);
  }
  .link {
    color: var(--accent, var(--rare));
    text-decoration: underline;
  }
  .wallet {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 26px;
    font-weight: 700;
    color: var(--mythic-2);
    white-space: nowrap;
  }
  .wallet span {
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .flash {
    background: color-mix(in srgb, var(--uncommon) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--uncommon) 40%, var(--line));
    border-radius: var(--radius-sm);
    padding: 9px 14px;
    font-size: 13px;
    margin-bottom: 16px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 14px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }
  .face {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 20px 12px 16px;
    text-align: center;
    background:
      radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%),
      var(--surface);
    border-bottom: 2px solid var(--accent);
  }
  .ic {
    font-size: 30px;
    line-height: 1;
  }
  .face h2 {
    font-size: 15px;
    font-weight: 700;
  }
  .held {
    font-size: 11px;
    color: color-mix(in srgb, var(--accent) 70%, var(--text));
  }
  .buy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
  }
  .buy button {
    padding: 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    font-size: 13px;
    color: var(--text-dim);
    transition: all var(--dur) var(--ease);
  }
  .buy button:not(:disabled):hover {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .buy button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .foot {
    margin-top: 24px;
    font-size: 13px;
    color: var(--text-faint);
  }
</style>
