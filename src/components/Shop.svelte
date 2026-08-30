<script lang="ts">
  import { TAGS } from '../lib/tags';
  import { THEMES } from '../lib/themes';
  import { knowledge } from '../lib/shop';
  import { view } from '../stores/view';
</script>

<section class="shop wrap">
  <header class="head">
    <div>
      <h1>Shop <span class="soon mono">coming soon</span></h1>
      <p class="sub">
        <strong>Knowledge</strong> is the currency you get for
        <button class="link" onclick={() => view.set('collection')}>disenchanting cards</button> —
        rarer cards, foils and negated cards are worth more. There's nothing to spend it on
        yet: thematic packs, which draw all seven cards from a single theme, are still being
        built. Your balance keeps accruing until they land.
      </p>
    </div>
    <div class="wallet mono">📖 {$knowledge}<span>knowledge</span></div>
  </header>

  <h2>Themes in the works</h2>
  <div class="grid" aria-label="Planned thematic packs">
    {#each TAGS as t (t)}
      <article class="tile" style:--accent={THEMES[t].color}>
        <span class="ic">{THEMES[t].icon}</span>
        <span class="name">{THEMES[t].label}</span>
      </article>
    {/each}
  </div>
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
    margin-bottom: 30px;
  }
  h1 {
    font-size: clamp(26px, 4vw, 40px);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .soon {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--text-dim);
    padding: 2px 7px;
    border-radius: 999px;
    vertical-align: middle;
  }
  .sub {
    color: var(--text-dim);
    font-size: 14px;
    margin-top: 10px;
    max-width: 62ch;
    line-height: 1.65;
  }
  .sub strong {
    color: var(--text);
  }
  .link {
    color: var(--rare);
    text-decoration: underline;
    text-underline-offset: 2px;
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
  h2 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin-bottom: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .tile {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 13px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    background: var(--surface);
    /* unavailable, and it should look it */
    opacity: 0.62;
  }
  .ic {
    font-size: 18px;
    line-height: 1;
  }
  .name {
    font-size: 13px;
    color: var(--text-dim);
  }
</style>
