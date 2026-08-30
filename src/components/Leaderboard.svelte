<script lang="ts">
  import { topPlayers, type LadderRow, type Page } from '../lib/arena/ladder';
  import { readCache, writeCache } from '../lib/arena/cache';
  import { displayName } from '../lib/arena/profile';
  import { RANKED_MIN_GAMES } from '../lib/arena/elo';

  interface Props {
    myUid?: string;
  }
  let { myUid }: Props = $props();

  const CACHE_KEY = 'wikitcg:ladder-cache:v1:top';

  let rows = $state<LadderRow[]>([]);
  let cursor: Page<LadderRow>['cursor'] = null;
  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state<string | null>(null);
  let hasMore = $state(false);

  async function fetchFirst(force: boolean) {
    loading = true;
    error = null;
    if (!force) {
      const cached = readCache<LadderRow[]>(CACHE_KEY);
      if (cached) {
        rows = cached;
        loading = false;
        // still let the cursor resolve in the background for "load more"
      }
    }
    try {
      const page = await topPlayers();
      rows = page.rows;
      cursor = page.cursor;
      hasMore = page.rows.length >= 25;
      writeCache(CACHE_KEY, page.rows);
    } catch (e) {
      if (rows.length === 0) error = 'Ladder unavailable right now.';
      void e;
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await topPlayers(cursor);
      rows = [...rows, ...page.rows];
      cursor = page.cursor;
      hasMore = page.rows.length >= 25;
    } catch {
      hasMore = false;
    } finally {
      loadingMore = false;
    }
  }

  $effect(() => {
    void fetchFirst(false);
  });

  const winRate = (r: LadderRow) => {
    const total = r.wins + r.losses + r.draws;
    return total ? Math.round((r.wins / total) * 100) : 0;
  };
</script>

<div class="board">
  <div class="head">
    <h3>Ladder</h3>
    <button class="btn btn--ghost sm" onclick={() => fetchFirst(true)} disabled={loading}>
      {loading ? 'Loading…' : 'Refresh'}
    </button>
  </div>

  {#if error && rows.length === 0}
    <p class="msg">{error}</p>
  {:else if rows.length === 0 && !loading}
    <p class="msg">
      {RANKED_MIN_GAMES > 0
        ? `No ranked players yet — the board opens up once players have ${RANKED_MIN_GAMES} rated battles.`
        : 'No players on the ladder yet — publish a defence and battle someone.'}
    </p>
  {:else}
    <ol class="rows">
      {#each rows as r, i (r.uid)}
        <li class:me={r.uid === myUid}>
          <span class="rank mono">{i + 1}</span>
          <span class="who">{displayName(r.handle, r.uid)}</span>
          <span class="rating mono">{r.rating}</span>
          <span class="wl mono">{r.wins}–{r.losses}–{r.draws}</span>
          <span class="rate mono">{winRate(r)}%</span>
        </li>
      {/each}
    </ol>
    {#if hasMore}
      <button class="btn btn--ghost sm more" onclick={loadMore} disabled={loadingMore}>
        {loadingMore ? 'Loading…' : 'Load more'}
      </button>
    {/if}
  {/if}
</div>

<style>
  .board {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 16px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  h3 {
    font-size: 15px;
    font-weight: 700;
  }
  .sm {
    font-size: 12px;
    padding: 6px 12px;
  }
  .msg {
    color: var(--text-dim);
    font-size: 13px;
    padding: 16px 4px;
    line-height: 1.5;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .rows li {
    display: grid;
    grid-template-columns: 28px 1fr auto auto auto;
    align-items: baseline;
    gap: 12px;
    padding: 9px 6px;
    font-size: 13px;
    border-top: 1px solid var(--line);
  }
  .rows li:first-child {
    border-top: none;
  }
  .rows li.me {
    background: color-mix(in srgb, var(--accent, var(--text)) 10%, transparent);
    border-radius: var(--radius-sm);
  }
  .rank {
    color: var(--text-faint);
  }
  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rating {
    font-weight: 700;
  }
  .wl,
  .rate {
    color: var(--text-dim);
    font-size: 12px;
  }
  .more {
    margin-top: 12px;
    width: 100%;
  }
</style>
