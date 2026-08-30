<script lang="ts">
  import { collection } from '../lib/collection';
  import { battleTeam } from '../lib/battle/team';
  import { assembleTeam, simulate, type BattleResult, type TeamStats } from '../lib/battle/engine';
  import { ROLE_META } from '../lib/battle/classify';
  import { decodeDefence, encodeDefence } from '../lib/battle/defence';
  import { view } from '../stores/view';
  import { arenaConfigured, getArena } from '../lib/firebase';
  import { profile, validateHandle, displayName } from '../lib/arena/profile';
  import {
    publishDefence,
    removeDefence,
    myDefence,
    browseDefences,
    myPriorAttack,
    submitAttack,
    type DefenceRow
  } from '../lib/arena/ladder';
  import Leaderboard from './Leaderboard.svelte';
  import BattlePlayback, { type CrestChip } from './BattlePlayback.svelte';
  import Card from './Card.svelte';
  import { RARITIES } from '../lib/types';

  type Boot = 'loading' | 'ready' | 'unavailable' | 'unconfigured';
  let boot = $state<Boot>('loading');
  let uid = $state<string>('');
  let tab = $state<'ladder' | 'browse' | 'mine'>('ladder');

  // --- my team -----------------------------------------------------------------
  const myCards = $derived(
    $battleTeam.map((id) => $collection[id]?.card).filter((c): c is NonNullable<typeof c> => !!c)
  );
  const myTeam = $derived(assembleTeam(myCards));
  const myCrest = $derived(crestOf(myTeam));

  function crestOf(team: TeamStats): CrestChip[] {
    return team.members.slice(0, 7).map((m) => ({
      icon: m.effect ? m.effect.icon : ROLE_META.living.icon,
      label: m.effect ? `${m.card.title} — ${m.effect.name}` : `${m.card.title} — ${ROLE_META.living.label}`,
      rarity: m.card.rarity
    }));
  }

  // --- boot ------------------------------------------------------------------
  $effect(() => {
    if (!arenaConfigured) {
      boot = 'unconfigured';
      return;
    }
    getArena()
      .then(({ uid: u }) => {
        uid = u;
        profile.setUid(u);
        boot = 'ready';
      })
      .catch(() => {
        boot = 'unavailable';
      });
  });

  // --- handle --------------------------------------------------------------
  let handleDraft = $state('');
  let handleErr = $state<string | null>(null);
  const needsHandle = $derived(boot === 'ready' && !$profile.handle);

  function saveHandle() {
    const err = validateHandle(handleDraft);
    handleErr = err;
    if (err) return;
    profile.setHandle(handleDraft);
  }

  // --- my defence --------------------------------------------------------------
  let published = $state<DefenceRow | null>(null);
  let publishing = $state(false);
  let mineLoaded = $state(false);

  async function loadMine() {
    try {
      published = await myDefence();
    } catch {
      published = null;
    }
    mineLoaded = true;
  }

  $effect(() => {
    if (boot === 'ready' && !needsHandle && tab === 'mine' && !mineLoaded) void loadMine();
  });

  async function doPublish() {
    if (myCards.length === 0) return;
    publishing = true;
    try {
      await publishDefence(myCards);
      await loadMine();
      flash = published ? 'Defence updated.' : 'Defence published.';
    } catch {
      flash = 'Could not publish — try again.';
    } finally {
      publishing = false;
    }
  }

  async function doRemove() {
    publishing = true;
    try {
      await removeDefence();
      published = null;
      flash = 'Defence removed.';
    } catch {
      flash = 'Could not remove — try again.';
    } finally {
      publishing = false;
    }
  }

  // --- browse + attack -------------------------------------------------------
  let browse = $state<DefenceRow[]>([]);
  let browseLoaded = $state(false);
  let browseErr = $state<string | null>(null);

  async function loadBrowse() {
    browseErr = null;
    try {
      const page = await browseDefences();
      browse = page.rows;
    } catch {
      browseErr = 'Could not load defences right now.';
    }
    browseLoaded = true;
  }

  $effect(() => {
    if (boot === 'ready' && !needsHandle && tab === 'browse' && !browseLoaded) void loadBrowse();
  });

  interface Fight {
    row: DefenceRow;
    result: BattleResult;
    defTeam: TeamStats;
    prior: string | null;
  }
  let fight = $state<Fight | null>(null);
  let fightErr = $state<string | null>(null);
  let submitting = $state(false);
  let flash = $state<string | null>(null);

  async function attack(row: DefenceRow) {
    fightErr = null;
    if (myCards.length === 0) {
      fightErr = 'Build a team in Battle before you attack.';
      return;
    }
    const decoded = await decodeDefence(row.code);
    if (!decoded.ok) {
      fightErr = decoded.error;
      return;
    }
    const defTeam = assembleTeam(decoded.cards);
    const result = simulate(myTeam, defTeam, { bName: displayName(row.handle, row.uid) });
    let prior: string | null = null;
    try {
      const p = await myPriorAttack(row.uid);
      if (p?.rated) prior = p.outcome === 'fall' ? 'You already beat this defence (rated).' : 'You already lost to this defence (rated).';
    } catch {
      /* non-fatal */
    }
    fight = { row, result, defTeam, prior };
  }

  async function finishFight() {
    if (!fight) return;
    submitting = true;
    const { row, result } = fight;
    try {
      const { rated, myDelta } = await submitAttack({
        defUid: row.uid,
        defHandle: row.handle,
        defenderCode: row.code,
        attackerCode: await encodeDefence(myCards),
        result
      });
      flash = rated
        ? `${result.outcome === 'win' ? 'Win' : result.outcome === 'draw' ? 'Draw' : 'Loss'} recorded · rating ${myDelta >= 0 ? '+' : ''}${myDelta}`
        : 'Rematch — result stored, rating unchanged.';
    } catch {
      flash = 'Battle finished, but the result could not be saved.';
    } finally {
      submitting = false;
      fight = null;
    }
  }
</script>

<section class="arena-view wrap">
  <header class="head">
    <h1>Arena <span class="beta mono">beta</span></h1>
    <p class="sub">
      Publish a defending team, then attack anyone else's. Battles play out here on your
      device — both teams bring their full kit. One rated result per opponent; the
      attacker strikes first.
    </p>
  </header>

  {#if boot === 'loading'}
    <p class="msg">Connecting…</p>
  {:else if boot === 'unconfigured'}
    <p class="msg">
      The Arena isn't configured for this build. It needs a Firebase project — see the
      <code>Arena</code> section of the README.
    </p>
  {:else if boot === 'unavailable'}
    <p class="msg">
      The Arena is unavailable right now (offline, or the service didn't respond). You can
      still practise in <button class="link" onclick={() => view.set('battle')}>Battle</button>.
    </p>
  {:else if needsHandle}
    <div class="handle">
      <h2>Pick a handle</h2>
      <p class="sub">Shown on the ladder. 3–20 characters — letters, numbers, spaces, - and _.</p>
      <div class="row">
        <input bind:value={handleDraft} placeholder="e.g. Ada" maxlength="20" />
        <button class="btn" onclick={saveHandle}>Continue</button>
      </div>
      {#if handleErr}<p class="err">{handleErr}</p>{/if}
    </div>
  {:else if fight}
    <BattlePlayback
      result={fight.result}
      aName={displayName($profile.handle, uid)}
      bName={displayName(fight.row.handle, fight.row.uid)}
      aMaxHp={myTeam.maxHp}
      bMaxHp={fight.defTeam.maxHp}
      aCrest={myCrest}
      bCrest={crestOf(fight.defTeam)}
      aBlurb={`${myTeam.attack} attack · ${myTeam.livingCount} fighting`}
      bBlurb={`${fight.defTeam.attack} attack · ${fight.defTeam.livingCount} fighting${fight.prior ? ` · ${fight.prior}` : ''}`}
      onExit={finishFight}
      exitLabel={submitting ? 'Saving…' : 'Done'}
    />
  {:else}
    {#if flash}
      <button class="flash" onclick={() => (flash = null)}>{flash} <span class="x">✕</span></button>
    {/if}

    <nav class="tabs">
      <button class:on={tab === 'ladder'} onclick={() => (tab = 'ladder')}>Ladder</button>
      <button class:on={tab === 'browse'} onclick={() => (tab = 'browse')}>Browse</button>
      <button class:on={tab === 'mine'} onclick={() => (tab = 'mine')}>My defence</button>
    </nav>

    {#if tab === 'ladder'}
      <Leaderboard myUid={uid} />
    {:else if tab === 'browse'}
      {#if fightErr}<p class="err">{fightErr}</p>{/if}
      {#if browseErr}
        <p class="msg">{browseErr}</p>
      {:else if !browseLoaded}
        <p class="msg">Loading defences…</p>
      {:else if browse.length === 0}
        <p class="msg">No defences to attack yet. Publish yours and check back.</p>
      {:else}
        <ul class="defences">
          {#each browse as row (row.uid)}
            <li>
              <div class="mini">
                {#each row.preview.slice(0, 7) as p, i (i)}
                  <span class="chip rarity-{RARITIES[p.r] ?? 'common'}">
                    {p.role === 1 ? ROLE_META.living.icon : ROLE_META.abstract.icon}
                  </span>
                {/each}
              </div>
              <div class="meta">
                <b>{displayName(row.handle, row.uid)}</b>
                <span class="mono dim">{row.hp} HP · {row.attack} atk</span>
              </div>
              <button class="btn sm" onclick={() => attack(row)} disabled={myCards.length === 0}>
                Attack
              </button>
            </li>
          {/each}
        </ul>
        <button class="btn btn--ghost sm wide" onclick={() => { browseLoaded = false; }}>Refresh</button>
      {/if}
    {:else}
      <!-- My defence -->
      {#if myCards.length === 0}
        <p class="msg">
          You have no team set. Build one in
          <button class="link" onclick={() => view.set('battle')}>Battle</button>, then come back to publish it.
        </p>
      {:else}
        <div class="mine">
          <div class="team">
            {#each myCards as c (c.id)}
              <div class="slot"><Card card={c} dupCount={$collection[c.id]?.count ?? 1} /></div>
            {/each}
          </div>
          <p class="stats mono">{myTeam.maxHp} HP pool · {myTeam.attack} attack · {myTeam.livingCount} fighting</p>
          <div class="actions">
            <button class="btn" onclick={doPublish} disabled={publishing}>
              {publishing ? 'Publishing…' : published ? 'Update defence' : 'Publish defence'}
            </button>
            {#if published}
              <button class="btn btn--ghost" onclick={doRemove} disabled={publishing}>Remove</button>
            {/if}
          </div>
          {#if published}
            <p class="sub">Live on the ladder as <b>{displayName(published.handle, uid)}</b>.</p>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .arena-view {
    padding-block: clamp(28px, 6vh, 64px);
  }
  .head {
    margin-bottom: 22px;
  }
  h1 {
    font-size: clamp(26px, 4vw, 40px);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .beta {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--mythic);
    padding: 1px 5px;
    border-radius: 4px;
    vertical-align: middle;
  }
  .sub {
    color: var(--text-dim);
    font-size: 13px;
    margin-top: 8px;
    line-height: 1.6;
    max-width: 62ch;
  }
  .msg {
    color: var(--text-dim);
    font-size: 14px;
    padding-block: 8vh;
    text-align: center;
    line-height: 1.6;
  }
  .link {
    color: var(--accent, var(--rare));
    text-decoration: underline;
  }
  .flash {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    text-align: left;
    background: color-mix(in srgb, var(--accent, var(--text)) 12%, transparent);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    font-size: 13px;
    color: var(--text);
    margin-bottom: 16px;
    cursor: pointer;
  }
  .flash .x {
    color: var(--text-faint);
    font-size: 11px;
  }
  .err {
    color: var(--mythic-2);
    font-size: 13px;
    margin-top: 8px;
  }

  .handle {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 22px;
    max-width: 440px;
  }
  .handle h2 {
    font-size: 17px;
    font-weight: 700;
  }
  .handle .row {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }
  input {
    flex: 1;
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 9px 12px;
  }

  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 18px;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    padding: 9px 14px;
    font-size: 14px;
    color: var(--text-dim);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent, var(--text));
  }

  .defences {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }
  .defences li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    border-top: 1px solid var(--line);
  }
  .defences li:first-child {
    border-top: none;
  }
  .mini,
  .team {
    display: flex;
  }
  .mini {
    gap: 3px;
    flex-wrap: wrap;
    max-width: 180px;
  }
  .chip {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    font-size: 10px;
    border: 1px solid color-mix(in srgb, var(--accent, var(--text)) 45%, var(--line));
    color: var(--accent, var(--text));
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
    min-width: 0;
  }
  .meta .dim {
    color: var(--text-faint);
    font-size: 12px;
  }
  .sm {
    font-size: 12px;
    padding: 7px 13px;
  }
  .wide {
    width: 100%;
    margin-top: 12px;
  }

  .mine {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 18px;
  }
  .team {
    gap: 10px;
    flex-wrap: wrap;
  }
  .slot {
    width: 108px;
  }
  .stats {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 14px;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
</style>
