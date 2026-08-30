<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { collection, favourites } from '../lib/collection';
  import { battleTeam } from '../lib/battle/team';
  import {
    assembleTeam,
    simulate,
    TEAM_SIZE,
    MAX_MYTHIC,
    type BattleResult
  } from '../lib/battle/engine';
  import { GOLDFISH } from '../lib/battle/opponents';
  import { classifyCard, ROLE_META, type Role } from '../lib/battle/classify';
  import { TAG_LABEL, TAGS, type Tag } from '../lib/tags';
  import { view } from '../stores/view';
  import Card from './Card.svelte';
  import { RARITIES, type Card as CardT, type Rarity } from '../lib/types';
  import { fuzzyMatch } from '../lib/fuzzy';

  type Phase = 'build' | 'fight';
  let phase = $state<Phase>('build');

  const owned = $derived(Object.values($collection).map((e) => e.card));
  const byId = $derived(new Map(owned.map((c) => [c.id, c] as const)));
  const roleOf = $derived(new Map(owned.map((c) => [c.id, classifyCard(c)] as const)));

  // --- roster filtering / sorting -----------------------------------------
  type RSort = 'power' | 'strength' | 'defence' | 'rarity' | 'recent' | 'name';
  let rarityFilter = $state<Rarity | 'all'>('all');
  let roleFilter = $state<'all' | Role>('all');
  let rsort = $state<RSort>('power');
  let query = $state('');
  let favOnly = $state(false);
  let themeFilter = $state<Tag | 'all'>('all');
  const q = $derived(query.trim().toLowerCase());
  // themes present across the roster, in canonical order — drives the theme row
  const themesInUse = $derived(
    (() => {
      const seen = new Set<string>();
      for (const c of owned) for (const t of c.tags ?? []) seen.add(t);
      return TAGS.filter((t) => seen.has(t));
    })()
  );
  const favCount = $derived(owned.filter((c) => $favourites.has(c.id)).length);
  // last favourite un-starred while the filter is on — drop back to the full grid
  $effect(() => {
    if (favCount === 0 && favOnly) favOnly = false;
  });

  // stored ids → cards, in pick order, dropping anything no longer owned
  const teamCards = $derived(
    $battleTeam.map((id) => byId.get(id)).filter((c): c is CardT => !!c)
  );
  const team = $derived(assembleTeam(teamCards));
  const slots = $derived(
    Array.from({ length: TEAM_SIZE }, (_, i) => team.members[i] ?? null)
  );
  const mythicCount = $derived(teamCards.filter((c) => c.rarity === 'mythic').length);
  const full = $derived(teamCards.length >= TEAM_SIZE);
  // filtered + sorted; picked cards keep their place and just get the ring, so
  // the grid never reshuffles under the cursor while you build
  const roster = $derived(
    owned
      .filter((c) => !q || fuzzyMatch(q, c.title).hit)
      .filter((c) => !favOnly || $favourites.has(c.id))
      .filter((c) => themeFilter === 'all' || (c.tags ?? []).includes(themeFilter))
      .filter((c) => rarityFilter === 'all' || c.rarity === rarityFilter)
      .filter((c) => roleFilter === 'all' || roleOf.get(c.id) === roleFilter)
      // a stat sort only lists cards that actually show that stat
      .filter((c) =>
        rsort === 'strength'
          ? roleOf.get(c.id) === 'living'
          : rsort === 'defence'
            ? roleOf.get(c.id) === 'abstract'
            : true
      )
      .sort((a, b) => {
        // an active query sorts by match quality, ahead of the chosen sort
        if (q) {
          const d = fuzzyMatch(q, b.title).score - fuzzyMatch(q, a.title).score;
          if (d !== 0) return d;
        }
        if (rsort === 'name') return a.title.localeCompare(b.title);
        if (rsort === 'strength') return b.strength - a.strength;
        if (rsort === 'defence') return b.defence - a.defence;
        if (rsort === 'rarity') {
          const d = RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity);
          return d !== 0 ? d : a.title.localeCompare(b.title);
        }
        if (rsort === 'recent') {
          const ta = $collection[a.id]?.firstOpenedAt ?? '';
          const tb = $collection[b.id]?.firstOpenedAt ?? '';
          return tb.localeCompare(ta);
        }
        return b.strength + b.defence - (a.strength + a.defence); // power
      })
  );

  function blockedReason(card: CardT): string | null {
    if ($battleTeam.includes(card.id)) return null;
    if (full) return `Team is full (${TEAM_SIZE})`;
    if (card.rarity === 'mythic' && mythicCount >= MAX_MYTHIC)
      return `Only ${MAX_MYTHIC} mythic per team`;
    return null;
  }

  function pick(card: CardT) {
    if (!$battleTeam.includes(card.id) && blockedReason(card)) return;
    battleTeam.toggle(card.id);
  }

  // --- fight playback -------------------------------------------------------
  let result = $state<BattleResult | null>(null);
  let shown = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function tick() {
    if (!result || shown >= result.rounds.length) return;
    shown += 1;
    // read the opening rounds at a human pace, then accelerate through a grind
    const delay = shown < 6 ? 800 : shown < 16 ? 360 : 130;
    timer = setTimeout(tick, delay);
  }

  function startFight() {
    if (teamCards.length === 0) return;
    clearTimeout(timer);
    result = simulate(team, GOLDFISH);
    shown = 0;
    phase = 'fight';
    timer = setTimeout(tick, 350);
  }

  function skip() {
    clearTimeout(timer);
    if (result) shown = result.rounds.length;
  }

  function backToBuild() {
    clearTimeout(timer);
    phase = 'build';
    result = null;
    shown = 0;
  }

  onDestroy(() => clearTimeout(timer));

  const curRound = $derived(result && shown > 0 ? result.rounds[shown - 1] : null);
  const playerHp = $derived(curRound ? curRound.playerHp : team.maxHp);
  const enemyHp = $derived(curRound ? curRound.enemyHp : GOLDFISH.maxHp);
  const visibleRounds = $derived(result ? result.rounds.slice(0, shown) : []);
  const done = $derived(!!result && shown >= result.rounds.length);

  const pctPlayer = $derived(Math.max(0, Math.min(100, (playerHp / Math.max(1, team.maxHp)) * 100)));
  const pctEnemy = $derived(
    Math.max(0, Math.min(100, (enemyHp / Math.max(1, GOLDFISH.maxHp)) * 100))
  );

  let logEl = $state<HTMLElement>();
  $effect(() => {
    void visibleRounds.length;
    logEl?.scrollTo({ top: logEl.scrollHeight, behavior: 'smooth' });
  });
</script>

<section class="battle wrap">
  {#if owned.length === 0}
    <div class="empty">
      <p>Open a pack first — you need cards to field a team.</p>
      <button class="btn" onclick={() => view.set('open')}>Open a pack →</button>
    </div>
  {:else if phase === 'build'}
    <header class="head">
      <div>
        <h1>Auto Battler <span class="beta mono">beta</span></h1>
        <p class="sub">
          Pick up to {TEAM_SIZE} cards ({MAX_MYTHIC} mythic max). Living cards — people, animals —
          fight, adding their Strength to the team's swing. Everything else (films, countries,
          concepts) sits on the field as terrain and lends a passive effect. Every card adds its
          Defence to the shared HP pool.
        </p>
      </div>
    </header>

    <div class="sheet">
      <div class="slots">
        {#each slots as m, i (i)}
          {#if m}
            <div class="slot" title="Remove {m.card.title}">
              <div class="frame">
                <Card
                  card={m.card}
                  onResolveImage={(url) => collection.setImage(m.card.id, url)}
                  onclick={() => battleTeam.remove(m.card.id)}
                />
              </div>
              <span class="role" title={m.effect ? m.effect.name : ROLE_META.living.label}>
                {m.effect ? m.effect.icon : ROLE_META.living.icon}
              </span>
              <span class="drop">remove</span>
            </div>
          {:else}
            <div class="slot">
              <div class="frame ph"><span class="plus">+</span></div>
            </div>
          {/if}
        {/each}
      </div>

      <div class="stats">
        <div class="stat"><b class="mono">{team.maxHp}</b><span>HP pool</span></div>
        <div class="stat"><b class="mono">{team.attack}</b><span>attack / round</span></div>
        <div class="stat">
          <b class="mono">{team.livingCount}<span class="dim">/{teamCards.length}</span></b>
          <span>fighters</span>
        </div>
      </div>

      {#if team.abstractCount > 0 || team.roundPlan.effects.length > 0 || team.signatures.length > 0}
        <ul class="effects">
          {#each team.members as m (m.card.id)}
            {#if m.effect}
              <li>
                <span class="eicon">{m.effect.icon}</span>
                <span class="etxt">
                  <b class="ename">{m.effect.name}</b>
                  <span class="edetail">{m.effect.detail}</span>
                  <span class="efrom">— {m.card.title}</span>
                </span>
              </li>
            {/if}
          {/each}
          {#each team.roundPlan.effects as e (e.from + e.tag)}
            <li class="round">
              <span class="eicon">{e.icon}</span>
              <span class="etxt">
                <b class="ename">{e.name}</b>
                <span class="edetail">{e.detail}</span>
                <span class="efrom">— {e.from}</span>
              </span>
            </li>
          {/each}
          {#each team.signatures as s (s.from + s.theme)}
            <li class="sig">
              <span class="eicon">★</span>
              <span class="etxt">
                <b class="ename">{s.name}</b>
                <span class="edetail">{s.detail}{s.count > 1 ? ` (N=${s.count})` : ''}</span>
                <span class="efrom">— {s.from}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="actions">
        {#if teamCards.length > 0}
          <button class="btn btn--ghost" onclick={() => battleTeam.clear()}>Clear</button>
        {/if}
        <button class="btn" disabled={teamCards.length === 0} onclick={startFight}>
          Fight the Goldfish →
        </button>
      </div>
    </div>

    <div class="filters">
      <input
        class="search"
        type="search"
        placeholder="Search cards…"
        aria-label="Search cards by title"
        bind:value={query}
      />
      <div class="chips">
        <button class:on={rarityFilter === 'all'} onclick={() => (rarityFilter = 'all')}>All</button>
        {#each RARITIES as r (r)}
          <button
            class="rarity-{r}"
            class:on={rarityFilter === r}
            onclick={() => (rarityFilter = r)}
          >
            {r}
          </button>
        {/each}
      </div>
      <div class="chips">
        <button class:on={roleFilter === 'all'} onclick={() => (roleFilter = 'all')}>Any role</button>
        <button class:on={roleFilter === 'living'} onclick={() => (roleFilter = 'living')}>
          ⚔ Fighters
        </button>
        <button class:on={roleFilter === 'abstract'} onclick={() => (roleFilter = 'abstract')}>
          ✦ Field
        </button>
        {#if favCount > 0}
          <button
            class="fav"
            class:on={favOnly}
            aria-pressed={favOnly}
            onclick={() => (favOnly = !favOnly)}
          >
            ★ Favourites <span class="mono">{favCount}</span>
          </button>
        {/if}
      </div>
      <label class="sort">
        Sort
        <select bind:value={rsort}>
          <option value="power">Power</option>
          <option value="strength">Strength</option>
          <option value="defence">Defence</option>
          <option value="rarity">Rarity</option>
          <option value="recent">Recent</option>
          <option value="name">Name</option>
        </select>
      </label>
    </div>

    {#if themesInUse.length > 0}
      <div class="themes">
        <button class:on={themeFilter === 'all'} onclick={() => (themeFilter = 'all')}>
          All themes
        </button>
        {#each themesInUse as t (t)}
          <button
            class:on={themeFilter === t}
            onclick={() => (themeFilter = themeFilter === t ? 'all' : t)}
          >
            {TAG_LABEL[t as Tag]}
          </button>
        {/each}
      </div>
    {/if}

    {#if roster.length === 0}
      <p class="none">No cards match these filters.</p>
    {:else}
      <div class="grid">
        {#each roster as card (card.id)}
          {@const picked = $battleTeam.includes(card.id)}
          {@const blocked = blockedReason(card)}
          <div class="pick" class:picked class:blocked={!!blocked} title={blocked ?? ''}>
            <Card {card} onclick={() => pick(card)} dupCount={$collection[card.id]?.count ?? 1} />
            {#if picked}<span class="flag">in team</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
  {:else if result}
    <div class="arena" in:fade={{ duration: 160 }}>
      <div class="sides">
        <div class="side enemy">
          <div class="fish">🐟</div>
          <h2>{GOLDFISH.name}</h2>
          <p class="hp mono">{enemyHp} / {GOLDFISH.maxHp}</p>
          <div class="bar"><span class="fill enemy" style="width:{pctEnemy}%"></span></div>
          <p class="blurb">{GOLDFISH.blurb}</p>
        </div>

        <div class="vs mono">vs</div>

        <div class="side you">
          <div class="crest">
            {#each team.members.slice(0, 7) as m (m.card.id)}
              <span
                class="chip rarity-{m.card.rarity}"
                title={m.effect ? `${m.card.title} — ${m.effect.name}` : `${m.card.title} — ${ROLE_META.living.label}`}
              >
                {m.effect ? m.effect.icon : ROLE_META.living.icon}
              </span>
            {/each}
          </div>
          <h2>Your team</h2>
          <p class="hp mono">{playerHp} / {team.maxHp}</p>
          <div class="bar"><span class="fill you" style="width:{pctPlayer}%"></span></div>
          <p class="blurb">{team.attack} attack · {team.livingCount} fighting · {team.abstractCount} on the field</p>
        </div>
      </div>

      <div class="log" bind:this={logEl}>
        {#each visibleRounds as r (r.n)}
          <div class="round" in:fly={{ y: 8, duration: 200 }}>
            <div class="rn mono">Round {r.n}</div>
            {#each r.lines as line}
              <p class="line {line.kind}">{line.text}</p>
            {/each}
          </div>
        {/each}
      </div>

      <div class="ctl">
        {#if !done}
          <button class="btn btn--ghost" onclick={skip}>Skip ⏭</button>
        {:else}
          <span class="verdict {result.outcome}">
            {result.outcome === 'win' ? 'Victory' : result.outcome === 'loss' ? 'Defeat' : 'Draw'}
            · {result.damageDealt} dealt · {result.damageTaken} taken
          </span>
          <button class="btn btn--ghost" onclick={startFight}>Rematch</button>
          <button class="btn" onclick={backToBuild}>Back to team</button>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .battle {
    padding-block: clamp(28px, 6vh, 64px);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding-block: 16vh;
    color: var(--text-dim);
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
    padding: 2px 5px;
    border-radius: 5px;
    vertical-align: middle;
  }
  .sub {
    margin-top: 8px;
    max-width: 68ch;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1.6;
  }

  /* --- team sheet --- */
  .sheet {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 18px;
    margin-bottom: 26px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .slots {
    display: grid;
    /* minmax(0,…) forces 7 equal columns regardless of their content */
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: clamp(6px, 1vw, 12px);
    align-items: start;
  }
  @media (max-width: 620px) {
    .slots {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .slot {
    position: relative;
    min-width: 0;
  }
  /* every slot — filled or empty — is a .frame: one card's worth of space. The
     card / placeholder is absolutely fitted inside it, so the two can never
     disagree on height. */
  .frame {
    position: relative;
    width: 100%;
    aspect-ratio: 2.5 / 3.5;
  }
  .frame :global(.card) {
    position: absolute;
    inset: 0;
    width: 100%;
  }
  .frame.ph {
    display: grid;
    place-items: center;
    border: 1px dashed var(--line);
    border-radius: var(--card-radius);
    background: var(--surface-2);
    color: var(--text-faint);
  }
  .slot .plus {
    font-size: 20px;
  }
  .slot .role {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 4;
    font-size: 11px;
    line-height: 1;
    padding: 3px 4px;
    border-radius: 5px;
    color: var(--text);
    background: color-mix(in srgb, var(--bg) 64%, transparent);
    backdrop-filter: blur(4px);
    pointer-events: none;
  }
  .slot .drop {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: grid;
    place-items: center;
    border-radius: var(--card-radius);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--bg);
    background: color-mix(in srgb, var(--mythic-2) 82%, transparent);
    opacity: 0;
    transition: opacity var(--dur) var(--ease);
    pointer-events: none;
  }
  .slot:hover .drop {
    opacity: 1;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 26px;
    padding-block: 4px;
    border-block: 1px solid var(--line);
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stat b {
    font-size: 22px;
    color: var(--text);
  }
  .stat b .dim {
    font-size: 14px;
    color: var(--text-faint);
  }
  .stat span {
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .effects {
    display: flex;
    flex-direction: column;
    gap: 5px;
    list-style: none;
    font-size: 13px;
  }
  .effects li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .eicon {
    flex: none;
    font-size: 14px;
    width: 1.1em;
    text-align: center;
  }
  .etxt {
    min-width: 0;
  }
  .ename {
    font-weight: 600;
    color: var(--uncommon);
    margin-right: 6px;
  }
  .effects li.round .ename {
    color: var(--rare);
  }
  .effects li.sig .ename,
  .effects li.sig .eicon {
    color: var(--mythic-2);
  }
  .effects li.sig .ename {
    font-weight: 700;
  }
  .edetail {
    color: var(--text-dim);
  }
  .efrom {
    color: var(--text-faint);
    font-size: 12px;
    margin-left: 6px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 10px 16px;
    margin-bottom: 22px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chips button {
    padding: 7px 14px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 12px;
    text-transform: capitalize;
    color: var(--text-dim);
    transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .chips button:hover {
    color: var(--text);
  }
  .chips button.on {
    color: var(--text);
    border-color: var(--accent, var(--text));
    background: color-mix(in srgb, var(--accent, var(--text)) 14%, transparent);
  }
  .chips button.fav {
    text-transform: none;
  }
  .chips button.fav .mono {
    font-size: 11px;
    color: var(--text-faint);
  }
  .chips button.fav.on {
    color: #f5c518;
    border-color: color-mix(in srgb, #f5c518 55%, transparent);
    background: color-mix(in srgb, #f5c518 14%, transparent);
  }
  .chips button.fav.on .mono {
    color: color-mix(in srgb, #f5c518 80%, var(--text));
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .sort select {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 7px 10px;
  }
  .search {
    flex: 1 1 180px;
    max-width: 320px;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
  }
  .search::placeholder {
    color: var(--text-faint);
  }
  .search:focus-visible {
    outline: 1px solid var(--accent, var(--rare));
    border-color: var(--accent, var(--rare));
  }
  .none {
    color: var(--text-dim);
    font-size: 14px;
    text-align: center;
    padding-block: 12vh;
  }
  .themes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: -8px 0 22px;
  }
  .themes button {
    padding: 6px 13px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 12px;
    color: var(--text-dim);
    transition: color var(--dur) var(--ease), background var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }
  .themes button:hover {
    color: var(--text);
  }
  .themes button.on {
    color: var(--bg);
    background: var(--text);
    border-color: var(--text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: clamp(14px, 2vw, 24px);
  }
  .pick {
    position: relative;
    border-radius: var(--card-radius);
    transition: transform var(--dur) var(--ease);
    /* poor-man's virtualisation: browser skips layout / paint / the foil
       animations for cards that aren't near the viewport */
    content-visibility: auto;
    contain-intrinsic-size: auto 280px;
  }
  .pick.picked {
    outline: 2px solid var(--accent, var(--rare));
    outline-offset: 3px;
    border-radius: var(--card-radius);
  }
  .pick.blocked {
    opacity: 0.4;
  }
  .pick.blocked :global(.flipper) {
    pointer-events: none;
  }
  .flag {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--accent, var(--rare));
    padding: 2px 8px;
    border-radius: 999px;
  }

  /* --- arena --- */
  .arena {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .sides {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 16px;
  }
  @media (max-width: 620px) {
    .sides {
      grid-template-columns: 1fr;
    }
    .vs {
      display: none;
    }
  }
  .side {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 18px;
    text-align: center;
  }
  .side h2 {
    font-size: 17px;
    font-weight: 700;
    margin-top: 6px;
  }
  .fish {
    font-size: 40px;
    line-height: 1;
  }
  .crest {
    display: flex;
    justify-content: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .chip {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    font-size: 11px;
    border: 1px solid color-mix(in srgb, var(--accent, var(--text)) 45%, var(--line));
    color: var(--accent, var(--text));
  }
  .hp {
    font-size: 13px;
    color: var(--text-dim);
    margin-top: 8px;
  }
  .bar {
    height: 8px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
    margin-top: 6px;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    transition: width 400ms var(--ease);
  }
  .fill.you {
    background: var(--uncommon);
  }
  .fill.enemy {
    background: var(--mythic-2);
  }
  .blurb {
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-faint);
    line-height: 1.5;
  }
  .vs {
    font-size: 13px;
    color: var(--text-faint);
    letter-spacing: 0.1em;
  }

  .log {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 14px 16px;
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .round {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .rn {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .line {
    font-size: 13px;
    line-height: 1.5;
  }
  .line.you {
    color: var(--uncommon);
  }
  .line.enemy {
    color: var(--mythic-2);
  }
  .line.field {
    color: var(--rare);
  }
  .line.result {
    font-weight: 700;
    color: var(--text);
    margin-top: 2px;
  }

  .ctl {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
    min-height: 44px;
  }
  .verdict {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-dim);
  }
  .verdict.win {
    color: var(--uncommon);
  }
  .verdict.loss {
    color: var(--mythic-2);
  }
</style>
