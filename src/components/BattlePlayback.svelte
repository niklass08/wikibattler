<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fly, fade, scale } from 'svelte/transition';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import type { BattleResult } from '../lib/battle/engine';
  import { toTimeline, type SideView, type BeatKind, type RoundBeats } from '../lib/battle/playback';
  import MiniCard from './battle/MiniCard.svelte';

  interface Props {
    result: BattleResult;
    a: SideView;
    b: SideView;
    onRematch?: () => void;
    onExit: () => void;
    exitLabel?: string;
  }

  let { result, a, b, onRematch, onExit, exitLabel = 'Back' }: Props = $props();

  const reduce =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const timeline = $derived(toTimeline(result, { aMaxHp: a.maxHp, bMaxHp: b.maxHp, bName: b.name }));
  const total = $derived(timeline.rounds.length);

  // ── playback state ────────────────────────────────────────────────────────
  let idx = $state(0); // rounds resolved so far (0 = pre-fight)
  let step = $state<'intro' | 'aStrike' | 'bStrike' | 'hold' | 'done'>('intro');
  let shakeStage = $state(false);
  let logOpen = $state(false);
  let timers: ReturnType<typeof setTimeout>[] = [];

  const D = reduce ? 0 : 1;
  // seeded here, then re-seeded from the current props by reset() on every fight
  /* svelte-ignore state_referenced_locally */
  const aHp = tweened(a.maxHp, { duration: 520 * D, easing: cubicOut });
  /* svelte-ignore state_referenced_locally */
  const bHp = tweened(b.maxHp, { duration: 520 * D, easing: cubicOut });
  /* svelte-ignore state_referenced_locally */
  const aGhost = tweened(a.maxHp, { duration: 1100 * D, easing: cubicOut });
  /* svelte-ignore state_referenced_locally */
  const bGhost = tweened(b.maxHp, { duration: 1100 * D, easing: cubicOut });

  interface Float {
    id: number;
    side: 'a' | 'b';
    amount: number;
    heal: boolean;
    kind: BeatKind;
  }
  let floats = $state<Float[]>([]);
  let floatId = 0;

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const after = (ms: number, fn: () => void) => {
    timers.push(setTimeout(fn, reduce ? Math.min(ms, 40) : ms));
  };

  function reset() {
    clearTimers();
    idx = 0;
    step = 'intro';
    floats = [];
    aHp.set(a.maxHp, { duration: 0 });
    bHp.set(b.maxHp, { duration: 0 });
    aGhost.set(a.maxHp, { duration: 0 });
    bGhost.set(b.maxHp, { duration: 0 });
    if (reduce) {
      // no animated playback — jump to the outcome, the log has the detail
      skip();
      return;
    }
    after(620, advance);
  }

  function advance() {
    if (idx >= total) return finish();
    idx += 1;
    runRound(timeline.rounds[idx - 1]);
  }

  function bump(side: 'a' | 'b', amount: number, kind: BeatKind, heal: boolean) {
    const id = floatId++;
    floats = [...floats, { id, side, amount, kind, heal }];
    after(1200, () => (floats = floats.filter((f) => f.id !== id)));
  }

  function runRound(r: RoundBeats) {
    const big = (amt: number, max: number) => !reduce && amt > max * 0.12;

    const seq: Array<() => void> = [];

    if (r.aDealt > 0) {
      seq.push(() => {
        step = 'aStrike';
        bHp.set(Math.max(0, r.bStart - r.aDealt));
        bGhost.set(Math.max(0, r.bStart - r.aDealt));
        bump('b', r.aDealt, dominantFx(r, 'a'), false);
        if (big(r.aDealt, b.maxHp)) flashStage();
      });
    }
    if (r.bDealt > 0) {
      seq.push(() => {
        step = 'bStrike';
        aHp.set(Math.max(0, r.aStart - r.bDealt));
        aGhost.set(Math.max(0, r.aStart - r.bDealt));
        bump('a', r.bDealt, dominantFx(r, 'b'), false);
        if (big(r.bDealt, a.maxHp)) flashStage();
      });
    }
    seq.push(() => {
      step = 'hold';
      // settle to the true end-of-round pools (regen / blooms healed)
      aHp.set(r.aEnd);
      bHp.set(r.bEnd);
      aGhost.set(r.aEnd);
      bGhost.set(r.bEnd);
      if (r.aHealed > 0) bump('a', r.aHealed, 'regen', true);
      if (r.bHealed > 0) bump('b', r.bHealed, 'regen', true);
    });

    const beat = idx <= 5 ? 620 : idx <= 14 ? 380 : 190;
    let i = 0;
    const next = () => {
      if (i < seq.length) {
        seq[i++]();
        after(beat, next);
      } else {
        after(idx <= 5 ? 420 : 200, advance);
      }
    };
    next();
  }

  function flashStage() {
    shakeStage = true;
    after(320, () => (shakeStage = false));
  }

  function finish() {
    clearTimers();
    step = 'done';
    aHp.set(timeline.rounds.at(-1)?.aEnd ?? a.maxHp);
    bHp.set(timeline.rounds.at(-1)?.bEnd ?? b.maxHp);
  }

  function skip() {
    clearTimers();
    idx = total;
    const last = timeline.rounds.at(-1);
    aHp.set(last?.aEnd ?? a.maxHp, { duration: 0 });
    bHp.set(last?.bEnd ?? b.maxHp, { duration: 0 });
    aGhost.set(last?.aEnd ?? a.maxHp, { duration: 0 });
    bGhost.set(last?.bEnd ?? b.maxHp, { duration: 0 });
    floats = [];
    step = 'done';
  }

  // (re)start whenever a fresh result arrives
  $effect(() => {
    void result;
    reset();
  });
  onDestroy(clearTimers);

  // ── derived view ─────────────────────────────────────────────────────────
  const curRound = $derived(idx > 0 ? timeline.rounds[Math.min(idx, total) - 1] : null);
  const done = $derived(step === 'done');
  const pct = (hp: number, max: number) => Math.max(0, Math.min(100, (hp / Math.max(1, max)) * 100));
  const aPct = $derived(pct($aHp, a.maxHp));
  const bPct = $derived(pct($bHp, b.maxHp));
  const aGhostPct = $derived(pct($aGhost, a.maxHp));
  const bGhostPct = $derived(pct($bGhost, b.maxHp));
  const lean = $derived(Math.max(-46, Math.min(46, (aPct - bPct) / 2)));

  const outcome = $derived(timeline.outcome);
  const verdictWord = $derived(
    outcome === 'win' ? 'Victory' : outcome === 'loss' ? 'Defeat' : 'Draw'
  );

  const visibleRounds = $derived(result.rounds.slice(0, Math.max(idx, done ? total : idx)));

  let logEl = $state<HTMLElement>();
  $effect(() => {
    void visibleRounds.length;
    void step;
    if (!logOpen) logEl?.scrollTo({ top: logEl.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  });

  // ── fx helpers ───────────────────────────────────────────────────────────
  const FX: Record<string, { icon: string; label: string; tone: string }> = {
    combo: { icon: '🎮', label: 'Combo', tone: 'var(--mythic)' },
    blitz: { icon: '🗡️', label: 'Blitz', tone: 'var(--mythic-2)' },
    overdrive: { icon: '🚗', label: 'Overdrive', tone: 'var(--rare)' },
    dot: { icon: '🦠', label: 'Contagion', tone: 'var(--uncommon)' },
    bloom: { icon: '🌱', label: 'Bloom', tone: 'var(--uncommon)' },
    reflect: { icon: '🛡️', label: 'Reflect', tone: 'var(--rare)' },
    shield: { icon: '✨', label: 'Divine Shield', tone: 'var(--mythic-2)' }
  };
  const ORDER: BeatKind[] = ['combo', 'blitz', 'overdrive', 'reflect', 'shield', 'bloom', 'dot'];
  function dominantFx(r: RoundBeats, by: 'a' | 'b'): BeatKind {
    const k = r.beats.find((x) => x.by === by && ORDER.includes(x.kind) && !x.heal)?.kind;
    return k ?? 'swing';
  }
  const curFx = $derived(
    curRound ? ORDER.filter((k) => curRound.fx.includes(k)).slice(0, 2) : []
  );

  const lineIcon = (kind: string) =>
    kind === 'you' ? '⚔' : kind === 'enemy' ? '🛡' : kind === 'result' ? '★' : '·';

  function bonusActive(fires: BeatKind[]): boolean {
    return !!curRound && !done && fires.some((f) => curRound.fx.includes(f));
  }

  const floatColor = (f: Float) =>
    f.heal
      ? 'var(--uncommon)'
      : f.kind in FX
        ? FX[f.kind].tone
        : f.side === 'b'
          ? 'var(--mythic-2)'
          : 'var(--mythic-2)';
</script>

<div class="pb" class:shake={shakeStage} class:over={done} in:fade={{ duration: 180 }}>
  <!-- top bar -->
  <div class="bar">
    <span class="round-pill mono">
      {#if done}Final{:else if idx === 0}Ready{:else}Round {Math.min(idx, total)} / {total}{/if}
    </span>
    <div class="momentum" aria-hidden="true">
      <span class="mtrack"></span>
      <span class="mmark" style="left:calc(50% + {lean}%)"></span>
      <span class="mlabel a">{Math.round(aPct)}%</span>
      <span class="mlabel b">{Math.round(bPct)}%</span>
    </div>
    {#if !done}
      <button class="mini-btn" onclick={skip}>Skip ⏭</button>
    {:else}
      <span class="mini-btn ghost">{outcome === 'win' ? 'Won' : outcome === 'loss' ? 'Lost' : 'Draw'}</span>
    {/if}
  </div>

  <!-- stage -->
  <div class="stage">
    {#each [{ s: a, side: 'a' as const, pctv: aPct, ghost: aGhostPct, striking: step === 'aStrike', hit: step === 'bStrike' }, { s: b, side: 'b' as const, pctv: bPct, ghost: bGhostPct, striking: step === 'bStrike', hit: step === 'aStrike' }] as col (col.side)}
      <section
        class="team {col.side}"
        class:striking={col.striking}
        class:hit={col.hit}
        class:winner={done && outcome !== 'draw' && ((col.side === 'a') === (outcome === 'win'))}
        class:loser={done && outcome !== 'draw' && ((col.side === 'a') !== (outcome === 'win'))}
      >
        <header>
          <h2>{col.s.name}</h2>
          <p class="sub">{col.s.subtitle}</p>
        </header>

        <div class="hpwrap">
          <div class="hpbar">
            <span class="ghost" style="width:{col.ghost}%"></span>
            <span class="fill" style="width:{col.pctv}%"></span>
            <span class="shine"></span>
          </div>
          <span class="hpnum mono">
            {Math.round(col.side === 'a' ? $aHp : $bHp).toLocaleString()}<i>/{col.s.maxHp.toLocaleString()}</i>
          </span>
        </div>

        <div class="cards">
          {#if col.s.cards.length}
            {#each col.s.cards as card, i (card.id)}
              <div class="cardslot" style="--i:{i}">
                <MiniCard {card} role={col.s.roles[i]} down={done && (col.side === 'a') !== (outcome === 'win') && outcome !== 'draw'} />
              </div>
            {/each}
          {:else}
            <div class="dummy">{col.s.fallbackIcon || '🎯'}</div>
          {/if}
        </div>

        <!-- floating numbers -->
        <div class="floats">
          {#each floats.filter((f) => f.side === col.side) as f (f.id)}
            <span
              class="float"
              class:heal={f.heal}
              style="color:{floatColor(f)}; --x:{(f.id % 5) * 14 - 28}px"
              in:fly={{ y: 14, duration: 180 }}
              out:fade={{ duration: 260 }}
            >
              {f.heal ? '+' : '−'}{f.amount.toLocaleString()}
              {#if f.kind in FX}<i>{FX[f.kind].icon}</i>{/if}
            </span>
          {/each}
        </div>
      </section>
    {/each}

    <!-- clash flourish -->
    <div class="clash" aria-hidden="true">
      <span class="swords" class:active={step === 'aStrike' || step === 'bStrike'}>⚔</span>
      {#if curFx.length && !done}
        {#key curFx.join()}
          <div class="callout" in:scale={{ start: 0.6, duration: 220 }} out:fade={{ duration: 160 }}>
            {#each curFx as k}
              <span style="--tone:{FX[k].tone}">{FX[k].icon} {FX[k].label}</span>
            {/each}
          </div>
        {/key}
      {/if}
    </div>
  </div>

  <!-- bonuses -->
  <div class="bonuses">
    {#each [{ s: a, side: 'a' }, { s: b, side: 'b' }] as col (col.side)}
      <div class="blist {col.side}">
        <h3>{col.s.name} — bonuses</h3>
        {#if col.s.bonuses.length}
          <ul>
            {#each col.s.bonuses as bo, i (bo.name + bo.from + i)}
              <li class="{bo.kind}" class:active={bonusActive(bo.fires)}>
                <span class="bi">{bo.icon}</span>
                <span class="bt">
                  <b>{bo.name}</b>
                  <span class="bd">{bo.detail}</span>
                  <span class="bf">— {bo.from}</span>
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="none">No field bonuses — raw stats only.</p>
        {/if}
      </div>
    {/each}
  </div>

  <!-- verdict -->
  {#if done}
    <div class="verdict {outcome}" in:scale={{ start: 0.7, duration: 320, easing: cubicOut }}>
      <span class="stamp">{verdictWord}</span>
      <span class="tally mono">
        {result.damageDealt.toLocaleString()} dealt · {result.damageTaken.toLocaleString()} taken · {total}
        {total === 1 ? 'round' : 'rounds'}
      </span>
      <div class="acts">
        {#if onRematch}<button class="btn btn--ghost" onclick={onRematch}>Rematch</button>{/if}
        <button class="btn" onclick={onExit}>{exitLabel}</button>
      </div>
    </div>
  {/if}

  <!-- fight log -->
  <div class="logpanel" class:open={logOpen}>
    <button class="loghead" onclick={() => (logOpen = !logOpen)}>
      <span>Fight log</span>
      <span class="mono dim">{visibleRounds.length}/{total} rounds</span>
      <span class="chev">{logOpen ? '▾' : '▸'}</span>
    </button>
    <div class="log" bind:this={logEl}>
      {#each visibleRounds as r (r.n)}
        <div class="lround" in:fly={{ y: 6, duration: 160 }}>
          <div class="rn mono">Round {r.n}</div>
          {#each r.lines as line, i (i)}
            <p class="line {line.kind}"><i class="lic">{lineIcon(line.kind)}</i>{line.text}</p>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .pb {
    display: flex;
    flex-direction: column;
    gap: 18px;
    position: relative;
  }
  .pb.shake {
    animation: shake 320ms var(--ease);
  }
  @keyframes shake {
    0%, 100% { transform: translate(0, 0); }
    20% { transform: translate(-4px, 2px); }
    40% { transform: translate(5px, -2px); }
    60% { transform: translate(-3px, 3px); }
    80% { transform: translate(3px, -1px); }
  }

  /* top bar */
  .bar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 16px;
  }
  .round-pill {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .momentum {
    position: relative;
    height: 22px;
  }
  .mtrack {
    position: absolute;
    inset: 9px 0;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--uncommon), var(--line) 45% 55%, var(--mythic-2));
    opacity: 0.5;
  }
  .mmark {
    position: absolute;
    top: 3px;
    width: 3px;
    height: 16px;
    border-radius: 2px;
    background: var(--text);
    transform: translateX(-50%);
    transition: left 520ms var(--ease);
    box-shadow: 0 0 10px var(--text);
  }
  .mlabel {
    position: absolute;
    top: 3px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
  }
  .mlabel.a { left: 0; }
  .mlabel.b { right: 0; }
  .mini-btn {
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .mini-btn:hover { color: var(--text); }
  .mini-btn.ghost { cursor: default; }

  /* stage */
  .stage {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    padding: 20px;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background:
      radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--uncommon) 12%, transparent), transparent 55%),
      radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, var(--mythic-2) 12%, transparent), transparent 55%),
      linear-gradient(180deg, var(--surface), var(--bg));
    overflow: hidden;
  }
  .stage::after {
    /* vignette */
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 90px rgb(0 0 0 / 0.55);
  }
  @media (max-width: 640px) {
    .stage { grid-template-columns: 1fr; }
  }

  .team {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 70%, transparent);
    transition: transform 240ms var(--ease), filter 240ms var(--ease), box-shadow 240ms var(--ease);
  }
  .team.a { align-items: flex-start; }
  .team.b { align-items: flex-end; text-align: right; }
  .team.striking { transform: translateY(-6px) scale(1.015); box-shadow: 0 8px 30px color-mix(in srgb, var(--mythic-2) 30%, transparent); }
  .team.hit { animation: recoil 300ms var(--ease); filter: brightness(1.15) saturate(1.2); }
  @keyframes recoil {
    0% { transform: translateX(0); }
    30% { transform: translateX(var(--rk, 8px)); filter: brightness(1.4); }
    100% { transform: translateX(0); }
  }
  .team.a.hit { --rk: -9px; }
  .team.b.hit { --rk: 9px; }
  .team.winner { box-shadow: 0 0 0 1px var(--mythic-2), 0 0 40px color-mix(in srgb, var(--mythic-2) 40%, transparent); }
  .team.loser { filter: grayscale(0.55) brightness(0.72); }

  .team header h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .team .sub {
    font-size: 11px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }

  .hpwrap {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .team.b .hpwrap { align-items: flex-end; }
  .hpbar {
    position: relative;
    width: 100%;
    height: 12px;
    border-radius: 999px;
    background: var(--bg);
    overflow: hidden;
    border: 1px solid var(--line);
  }
  .hpbar .ghost,
  .hpbar .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    border-radius: 999px;
  }
  .team.b .hpbar .ghost,
  .team.b .hpbar .fill { left: auto; right: 0; }
  .hpbar .ghost { background: color-mix(in srgb, var(--mythic-2) 60%, #7a1d1d); opacity: 0.6; }
  .team.a .hpbar .fill { background: linear-gradient(90deg, #2f8f63, var(--uncommon)); box-shadow: 0 0 12px color-mix(in srgb, var(--uncommon) 60%, transparent); }
  .team.b .hpbar .fill { background: linear-gradient(90deg, var(--mythic-2), #e0a92e); box-shadow: 0 0 12px color-mix(in srgb, var(--mythic-2) 55%, transparent); }
  .hpbar .shine {
    position: absolute;
    inset: 0 0 auto 0;
    height: 45%;
    background: linear-gradient(180deg, rgb(255 255 255 / 0.28), transparent);
  }
  .hpnum { font-size: 12px; color: var(--text); }
  .hpnum i { color: var(--text-faint); font-style: normal; }

  .cards {
    display: flex;
    gap: 5px;
    width: 100%;
    flex-wrap: wrap;
  }
  .team.b .cards { justify-content: flex-end; }
  .cardslot {
    width: clamp(40px, 12%, 64px);
    animation: dealin 320ms var(--ease) backwards;
    animation-delay: calc(var(--i) * 45ms);
  }
  @keyframes dealin {
    from { opacity: 0; transform: translateY(10px) rotate(-3deg); }
  }
  .team.striking .cardslot { animation: none; }
  .dummy { font-size: 46px; line-height: 1; padding: 8px 0; }

  .floats {
    position: absolute;
    inset: 40px 0 auto 0;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .float {
    position: absolute;
    transform: translateX(var(--x, 0));
    font-family: var(--font-mono);
    font-weight: 800;
    font-size: clamp(16px, 4vw, 26px);
    text-shadow: 0 2px 8px rgb(0 0 0 / 0.7);
    animation: floatup 1200ms var(--ease) forwards;
  }
  .float i { font-size: 0.7em; }
  @keyframes floatup {
    0% { opacity: 0; transform: translate(var(--x, 0), 6px) scale(0.8); }
    18% { opacity: 1; transform: translate(var(--x, 0), -6px) scale(1.12); }
    40% { transform: translate(var(--x, 0), -14px) scale(1); }
    100% { opacity: 0; transform: translate(var(--x, 0), -52px) scale(0.9); }
  }

  .clash {
    position: absolute;
    left: 50%;
    top: 46%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    z-index: 2;
  }
  @media (max-width: 640px) { .clash { top: auto; bottom: 12px; } }
  .swords {
    font-size: 26px;
    filter: drop-shadow(0 0 10px rgb(0 0 0 / 0.8));
    opacity: 0.35;
    transition: transform 200ms var(--ease), opacity 200ms var(--ease);
  }
  .swords.active { opacity: 1; transform: scale(1.5) rotate(8deg); }
  .callout {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
  }
  .callout span {
    font-family: var(--font-mono);
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    color: var(--bg);
    background: var(--tone, var(--text));
    box-shadow: 0 4px 16px color-mix(in srgb, var(--tone, #000) 50%, transparent);
  }

  /* bonuses */
  .bonuses {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  @media (max-width: 640px) { .bonuses { grid-template-columns: 1fr; } }
  .blist {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 14px;
  }
  .blist h3 {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin-bottom: 10px;
  }
  .blist ul { display: flex; flex-direction: column; gap: 8px; }
  .blist li {
    display: flex;
    gap: 10px;
    padding: 8px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    transition: border-color 200ms var(--ease), background 200ms var(--ease), transform 200ms var(--ease);
  }
  .blist li.signature { background: color-mix(in srgb, var(--mythic) 10%, transparent); }
  .blist li.active {
    border-color: var(--mythic-2);
    background: color-mix(in srgb, var(--mythic-2) 16%, transparent);
    transform: translateX(2px);
  }
  .blist .bi { font-size: 15px; line-height: 1.3; }
  .blist .bt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .blist b { font-size: 13px; }
  .blist .bd { font-size: 11px; color: var(--text-dim); }
  .blist .bf { font-size: 10px; color: var(--text-faint); }
  .blist .none { font-size: 12px; color: var(--text-faint); }

  /* verdict */
  .verdict {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 22px;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background:
      radial-gradient(80% 120% at 50% 0%, color-mix(in srgb, var(--tone) 20%, transparent), transparent 70%),
      var(--surface);
  }
  .verdict.win { --tone: var(--uncommon); }
  .verdict.loss { --tone: var(--mythic-2); }
  .verdict.draw { --tone: var(--text-faint); }
  .verdict .stamp {
    font-size: clamp(28px, 7vw, 48px);
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--tone);
    text-shadow: 0 0 30px color-mix(in srgb, var(--tone) 55%, transparent);
  }
  .verdict .tally { font-size: 12px; color: var(--text-dim); }
  .verdict .acts { display: flex; gap: 10px; margin-top: 4px; flex-wrap: wrap; justify-content: center; }

  /* fight log */
  .logpanel {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }
  .loghead {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    font-size: 13px;
    font-weight: 600;
  }
  .loghead .dim { color: var(--text-faint); font-weight: 400; margin-left: auto; }
  .loghead .chev { color: var(--text-dim); }
  .log {
    max-height: 180px;
    overflow-y: auto;
    padding: 0 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scroll-behavior: smooth;
  }
  .logpanel.open .log { max-height: min(60vh, 620px); }
  .lround { display: flex; flex-direction: column; gap: 2px; }
  .rn {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    position: sticky;
    top: 0;
    background: var(--surface);
    padding: 2px 0;
  }
  .line { font-size: 12.5px; line-height: 1.5; display: flex; gap: 7px; }
  .line .lic { color: var(--text-faint); flex-shrink: 0; }
  .line.you { color: var(--uncommon); }
  .line.enemy { color: var(--mythic-2); }
  .line.field { color: var(--rare); }
  .line.result { color: var(--text); font-weight: 700; margin-top: 2px; }

  @media (prefers-reduced-motion: reduce) {
    .pb.shake, .team.hit, .cardslot, .float, .swords { animation: none !important; }
    .mmark, .team, .hpbar .fill, .hpbar .ghost { transition: none !important; }
  }

  /* Apple's touch guidance is a 44pt minimum; the desktop chip sizes land
     around 34-38px, which is fiddly under a thumb. */
  @media (max-width: 820px) {
    .mini-btn {
      padding-block: 12px;
    }
  }
</style>
