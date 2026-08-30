<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import type { BattleResult } from '../lib/battle/engine';

  export interface CrestChip {
    icon: string;
    label: string;
    rarity: string;
  }

  interface Props {
    result: BattleResult;
    aName: string;
    bName: string;
    aMaxHp: number;
    bMaxHp: number;
    aCrest?: CrestChip[];
    bCrest?: CrestChip[];
    aBlurb?: string;
    bBlurb?: string;
    bIcon?: string;
    onRematch?: () => void;
    onExit: () => void;
    exitLabel?: string;
  }

  let {
    result,
    aName,
    bName,
    aMaxHp,
    bMaxHp,
    aCrest = [],
    bCrest,
    aBlurb = '',
    bBlurb = '',
    bIcon = '🎯',
    onRematch,
    onExit,
    exitLabel = 'Back'
  }: Props = $props();

  let shown = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let logEl = $state<HTMLElement>();

  function tick() {
    if (shown >= result.rounds.length) return;
    shown += 1;
    // read the opening rounds at a human pace, then accelerate through a grind
    const delay = shown < 6 ? 800 : shown < 16 ? 360 : 130;
    timer = setTimeout(tick, delay);
  }

  // (re)start playback whenever a fresh result arrives
  $effect(() => {
    void result;
    shown = 0;
    clearTimeout(timer);
    timer = setTimeout(tick, 350);
    return () => clearTimeout(timer);
  });

  onDestroy(() => clearTimeout(timer));

  function skip() {
    clearTimeout(timer);
    shown = result.rounds.length;
  }

  const clampPct = (n: number) => Math.max(0, Math.min(100, n));
  const visibleRounds = $derived(result.rounds.slice(0, shown));
  const cur = $derived(shown > 0 ? result.rounds[shown - 1] : null);
  const aHp = $derived(cur ? cur.playerHp : aMaxHp);
  const bHp = $derived(cur ? cur.enemyHp : bMaxHp);
  const done = $derived(shown >= result.rounds.length);
  const pctA = $derived(clampPct((aHp / Math.max(1, aMaxHp)) * 100));
  const pctB = $derived(clampPct((bHp / Math.max(1, bMaxHp)) * 100));

  $effect(() => {
    void visibleRounds.length;
    logEl?.scrollTo({ top: logEl.scrollHeight, behavior: 'smooth' });
  });
</script>

<div class="arena" in:fade={{ duration: 160 }}>
  <div class="sides">
    <div class="side enemy">
      {#if bCrest}
        <div class="crest">
          {#each bCrest.slice(0, 7) as c, i (i)}
            <span class="chip rarity-{c.rarity}" title={c.label}>{c.icon}</span>
          {/each}
        </div>
      {:else}
        <div class="fish">{bIcon}</div>
      {/if}
      <h2>{bName}</h2>
      <p class="hp mono">{bHp} / {bMaxHp}</p>
      <div class="bar"><span class="fill enemy" style="width:{pctB}%"></span></div>
      {#if bBlurb}<p class="blurb">{bBlurb}</p>{/if}
    </div>

    <div class="vs mono">vs</div>

    <div class="side you">
      {#if aCrest.length}
        <div class="crest">
          {#each aCrest.slice(0, 7) as c, i (i)}
            <span class="chip rarity-{c.rarity}" title={c.label}>{c.icon}</span>
          {/each}
        </div>
      {/if}
      <h2>{aName}</h2>
      <p class="hp mono">{aHp} / {aMaxHp}</p>
      <div class="bar"><span class="fill you" style="width:{pctA}%"></span></div>
      {#if aBlurb}<p class="blurb">{aBlurb}</p>{/if}
    </div>
  </div>

  <div class="log" bind:this={logEl}>
    {#each visibleRounds as r (r.n)}
      <div class="round" in:fly={{ y: 8, duration: 200 }}>
        <div class="rn mono">Round {r.n}</div>
        {#each r.lines as line, i (i)}
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
      {#if onRematch}
        <button class="btn btn--ghost" onclick={onRematch}>Rematch</button>
      {/if}
      <button class="btn" onclick={onExit}>{exitLabel}</button>
    {/if}
  </div>
</div>

<style>
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
