<script lang="ts">
  import { view } from '../stores/view';
  import { FOIL_LABEL, NEGATED_LABEL, RARITY_LABEL, RARITIES, type Rarity } from '../lib/types';
  import { STAT_MAX } from '../lib/rarity';
  import {
    FOIL_PACK_CHANCE,
    GOD_PACK_CHANCE,
    NEGATE_CHANCE,
    PACK_SIZE,
    RARITY_THRESHOLDS
  } from '../lib/odds';
  import { TAGS, TAG_LABEL, type Tag } from '../lib/tags';
  import {
    EFFECTS,
    ROUND_EFFECTS,
    TAG_EFFECT,
    type EffectId,
    type RoundEffectDef,
    type RoundEffectTag
  } from '../lib/battle/effects.config';
  import { SIGNATURES } from '../lib/battle/signatures.config';
  import { GOLDFISH } from '../lib/battle/opponents';
  import { MAX_MYTHIC, ROUND_CAP, TEAM_SIZE } from '../lib/battle/engine';
  import { SIGNATURE_LEAN } from '../lib/odds';

  const oneIn = (p: number) => Math.round(1 / p);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  // monthly-view floor for each rarity, for the table
  const rarityFloor: Record<Rarity, string> = {
    common: '0',
    uncommon: RARITY_THRESHOLDS.uncommon.toLocaleString(),
    rare: RARITY_THRESHOLDS.rare.toLocaleString(),
    mythic: RARITY_THRESHOLDS.mythic.toLocaleString()
  };

  const EFFECT_BLURB: Record<EffectId, string> = {
    terrain: "Raises the team's max HP for the whole fight, scaling with the card's Defence.",
    spectacle: "Raises the team's attack, scaling with the card's Strength.",
    anthem: "Raises the team's attack and heals a little HP at the end of every round.",
    muse: "Raises the team's attack, scaling with the card's Strength.",
    metagame: "Raises the team's attack.",
    arsenal: "Adds a flat amount to the team's attack, scaling with Strength.",
    countermeasures: 'Reflects a share of every hit the team takes straight back at the attacker.',
    sponsorship: 'Heals the team a fixed amount at the end of every round.',
    doctrine: "A small boost to both the team's attack and its max HP.",
    legacy: "Adds a flat amount to the team's max HP, scaling with Defence.",
    faith: 'Heals the team each round and nudges up its max HP.',
    training: "Raises the team's attack.",
    landmark: 'The fallback for a field card with no clear theme — a flat max-HP bump.'
  };

  function roundBlurb(def: RoundEffectDef): string {
    switch (def.kind) {
      case 'dot':
        return `Damages the enemy every round, and the hit grows each round — it stacks. Starts around ${def.damage} and climbs by ${def.ramp} a round (before Strength scaling); more disease cards stack on top.`;
      case 'ramp':
        return `Adds +${pct(def.atkPctPerRound)} to the team's attack every round. It never stops climbing, so it wins long fights.`;
      case 'bloom':
        return `Charges for ${def.delay} rounds, then bursts the enemy for around ${def.damage}+ (scaling with Strength) — and blooms again every ${def.delay} rounds after.`;
      case 'overdrive':
        return `Charges for ${def.delay} rounds, then gives the team one extra attack that round — and again every ${def.delay} rounds.`;
    }
  }

  /** what a theme brings to a fight, for the themes table */
  function themeBattle(t: Tag): { icon: string; name: string; kind: string } {
    const round = ROUND_EFFECTS[t as RoundEffectTag];
    if (round) return { icon: round.icon, name: round.name, kind: 'round effect' };
    const id = TAG_EFFECT[t];
    if (id) return { icon: EFFECTS[id].icon, name: EFFECTS[id].name, kind: 'field effect' };
    return { icon: '·', name: '—', kind: '' };
  }

  const roundOrder: RoundEffectTag[] = ['scientists', 'plants', 'disease', 'vehicles'];
</script>

<section class="help wrap">
  <h1>How it works</h1>
  <p class="lede">
    WikiTCG turns Wikipedia into a card game. Every card is a real article; its numbers come
    straight from that article. Here's what all of it means.
  </p>

  <!-- ─── cards ─────────────────────────────────────────────────────── -->
  <h2>The cards</h2>
  <p>
    Open packs to collect cards. Each one is a live Wikipedia article — its art, its flavour text
    and its stats are pulled from the article and the Wikimedia APIs.
  </p>

  <h3>Rarity</h3>
  <p>Set by the article's average monthly pageviews — the more people read it, the rarer the card.</p>
  <div class="scroll">
    <table>
      <thead><tr><th>Rarity</th><th>Monthly views</th></tr></thead>
      <tbody>
        {#each RARITIES as r (r)}
          <tr>
            <td><span class="dot rarity-{r}"></span>{RARITY_LABEL[r]}</td>
            <td class="mono">
              {r === 'mythic' ? `≥ ${rarityFloor[r]}` : `${rarityFloor[r]} – ${rarityFloor[RARITIES[RARITIES.indexOf(r) + 1]]}`}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <h3>Strength &amp; Defence</h3>
  <ul class="defs">
    <li>
      <b>Strength</b> (1–{STAT_MAX}) — from the number of internal links in the article, on a log
      scale. Well-connected topics hit hard.
    </li>
    <li>
      <b>Defence</b> (1–{STAT_MAX}) — from the article's length in bytes, on a log scale. Long,
      detailed articles are tanky.
    </li>
  </ul>

  <h3>Finishes</h3>
  <ul class="defs">
    <li>
      <b>Foil</b> — a holographic finish, rolled per pack and independent of rarity. Roughly
      <b>1 pack in {oneIn(FOIL_PACK_CHANCE)}</b> holds a foil card, in tiers
      {FOIL_LABEL[1]} → {FOIL_LABEL[2]} → {FOIL_LABEL[3]} (skewed to the subtle end). About
      <b>1 pack in {oneIn(GOD_PACK_CHANCE)}</b> is a <em>god pack</em> — all {PACK_SIZE} cards foiled.
    </li>
    <li>
      <b>{NEGATED_LABEL}</b> — the card's colours inverted. Rolled per card, independently of foil,
      at roughly <b>1 in {oneIn(NEGATE_CHANCE)}</b>. A card can be foil <em>and</em> negated.
    </li>
  </ul>

  <!-- ─── packs ─────────────────────────────────────────────────────── -->
  <h2>Packs</h2>
  <p>
    A pack is {PACK_SIZE} cards. The base shape is 4 common, 2 uncommon and 1 guaranteed rare —
    then every slot rolls to climb the rarity ladder, and the deeper the slot in the pack, the
    better those odds. Any slot can chain all the way to mythic; it's just rare.
  </p>

  <!-- ─── disenchanting ─────────────────────────────────────────────── -->
  <h2>Knowledge</h2>
  <p>
    <strong>Disenchant</strong> a card — from its detail view, or "Disenchant duplicates"
    on the Collection — to turn it into <strong>knowledge</strong> 📖. Rarer cards, foils and
    negated cards are worth more. Disenchanting your last copy removes the card from the
    collection; favourited cards are safe until you un-favourite them.
  </p>
  <p class="fine">
    There is nothing to spend knowledge on yet — <strong>thematic packs</strong>, which draw
    all seven cards from one theme, are still being built. Your balance keeps accruing in the
    meantime; the Shop shows the themes that are on the way.
  </p>

  <!-- ─── battler ───────────────────────────────────────────────────── -->
  <h2>Auto Battler <span class="beta mono">beta</span></h2>
  <p>
    Build a team of up to {TEAM_SIZE} cards (at most {MAX_MYTHIC} mythic) and send it against an
    opponent. The whole fight resolves automatically, round by round.
  </p>
  <ul class="defs">
    <li><b>HP pool</b> — the sum of every card's Defence. One shared health bar for the team.</li>
    <li>
      <b>Attack / round</b> — the sum of Strength across your <b>fighter</b> cards only. Field cards
      don't swing.
    </li>
  </ul>

  <h3>Roles</h3>
  <p>Each card is one of two things, read from its article:</p>
  <ul class="defs">
    <li>
      <b>⚔️ Fighter</b> — a person, animal or other living thing. Adds its Strength to the team's
      attack every round.
    </li>
    <li>
      <b>✦ Field</b> — a film, place, event, object or concept. Never attacks, but plants an effect
      on the battlefield (below).
    </li>
  </ul>
  <p class="fine">Every card, whichever role, still adds its Defence to the shared HP pool.</p>

  <!-- ─── themes ────────────────────────────────────────────────────── -->
  <h2>Themes</h2>
  <p>
    A card's strongest Wikipedia theme decides what it brings to a fight. Fighters use their theme
    too — a scientist still swings <em>and</em> ramps the team's attack.
  </p>
  <div class="scroll">
    <table>
      <thead><tr><th>Theme</th><th>Brings</th><th></th></tr></thead>
      <tbody>
        {#each TAGS as t (t)}
          {@const b = themeBattle(t)}
          <tr>
            <td>{TAG_LABEL[t]}</td>
            <td><span class="i">{b.icon}</span> {b.name}</td>
            <td class="fine">{b.kind}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- ─── field effects ─────────────────────────────────────────────── -->
  <h2>Field effects</h2>
  <p>A field card with no scheduled ability plants one of these for the entire fight.</p>
  <div class="effects">
    {#each Object.keys(EFFECTS) as id (id)}
      {@const def = EFFECTS[id as EffectId]}
      <div class="effect">
        <span class="i">{def.icon}</span>
        <div>
          <b>{def.name}</b>
          <p>{EFFECT_BLURB[id as EffectId]}</p>
        </div>
      </div>
    {/each}
  </div>

  <!-- ─── round effects ─────────────────────────────────────────────── -->
  <h2>Round effects</h2>
  <p>
    Four themes don't just sit there — they act on a schedule during the fight. Same-theme cards
    stack, and they turn long, grinding fights in your favour.
  </p>
  <div class="effects">
    {#each roundOrder as tag (tag)}
      {@const def = ROUND_EFFECTS[tag]}
      <div class="effect">
        <span class="i">{def.icon}</span>
        <div>
          <b>{def.name}</b> <span class="fine">— {TAG_LABEL[tag]}</span>
          <p>{roundBlurb(def)}</p>
        </div>
      </div>
    {/each}
  </div>

  <!-- ─── the round ─────────────────────────────────────────────────── -->
  <h2>How a round plays out</h2>
  <ol class="steps">
    <li>Scientists ramp the team's attack a little higher than last round.</li>
    <li>The team swings — once, plus one extra strike for every vehicle that's finished charging.</li>
    <li>Contagion from any disease card festers, worse than the round before.</li>
    <li>Plants that have finished charging bloom for a burst of damage.</li>
    <li>The enemy hits back; Countermeasures reflect part of it.</li>
    <li>Field regen (Sponsorship, Anthem, Faith) heals the team.</li>
  </ol>
  <p class="fine">
    First side to 0 HP loses. A fight still going after {ROUND_CAP} rounds is a draw — bring more
    attack, or a disease card.
  </p>

  <!-- ─── mythic signatures ────────────────────────────────────────── -->
  <h2>Mythic signatures</h2>
  <p>
    Every mythic rolls one <strong>signature</strong> the moment it's pulled and keeps it for
    good. It shows as a gold ★ line on the card. The roll is
    {Math.round(SIGNATURE_LEAN * 100)}% one of the card's own themes and
    {Math.round((1 - SIGNATURE_LEAN) * 100)}% any of the 17.
  </p>
  <p>
    In a fight a signature pays out scaled by <strong>N</strong> — the number of team cards
    sharing its theme, the mythic always counted. Build the theme around the mythic and it
    snowballs.
  </p>
  <div class="effects">
    {#each TAGS as t (t)}
      {@const s = SIGNATURES[t]}
      <div class="effect">
        <span class="i">{s.icon}</span>
        <div>
          <b>★ {s.name}</b> <span class="fine">— {TAG_LABEL[t]}</span>
          <p>{s.blurb}</p>
        </div>
      </div>
    {/each}
  </div>

  <!-- ─── opponents ─────────────────────────────────────────────────── -->
  <h2>Opponents</h2>
  <p>
    In <b>Battle</b> there's the <b>{GOLDFISH.name}</b> — {GOLDFISH.maxHp.toLocaleString()} HP,
    {GOLDFISH.attack} attack. It barely fights back; it's a practice dummy to watch the pool, the
    roles and the round effects do their thing.
  </p>

  <!-- ─── arena ─────────────────────────────────────────────────────── -->
  <h2>Arena <span class="beta mono">beta</span></h2>
  <p>
    The <b>Arena</b> is a global ladder. Publish your current battle team as a
    <strong>defence</strong>, then attack anyone else's. Both teams bring their full kit —
    field effects, round effects, mythic signatures, regen, reflect — and trade blows until one
    HP pool empties or the round cap is hit.
  </p>
  <ul class="defs">
    <li>
      <b>Attacker strikes first.</b> If your opening swing empties the defender's pool, they
      never answer — so attacking is favoured, which keeps the ladder moving.
    </li>
    <li>
      <b>Elo rating.</b> Everyone starts at 1200. A win takes rating from your opponent, a loss
      gives it up, a draw is neutral. A new rating settles fast over its first several battles.
    </li>
    <li>
      <b>One rated result per opponent.</b> Re-attacking someone you've already fought still
      shows the outcome, but no longer moves either rating — so you can't farm one opponent.
    </li>
  </ul>
  <p class="fine">
    Battles are resolved on your own device and the result is self-reported — the maths is
    deterministic, so any battle can be replayed from the two team codes, but this is a
    friendly ladder, not a tamper-proof one.
  </p>

  <div class="cta">
    <button class="btn" onclick={() => view.set('open')}>Open a pack →</button>
  </div>
</section>

<style>
  .help {
    padding-block: clamp(28px, 6vh, 64px);
    max-width: 760px;
  }
  h1 {
    font-size: clamp(28px, 4vw, 42px);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .lede {
    margin-top: 10px;
    font-size: 16px;
    color: var(--text-dim);
    line-height: 1.6;
  }
  h2 {
    margin-top: 44px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  h3 {
    margin-top: 26px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
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
  p {
    margin-top: 12px;
    font-size: 14.5px;
    line-height: 1.65;
    color: var(--text-dim);
  }
  p b,
  li b {
    color: var(--text);
    font-weight: 600;
  }
  em {
    font-style: normal;
    color: var(--text);
  }
  .fine {
    font-size: 12.5px;
    color: var(--text-faint);
  }

  .defs {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    list-style: none;
  }
  .defs li {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-dim);
    padding-left: 14px;
    border-left: 2px solid var(--line);
  }

  .scroll {
    margin-top: 14px;
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  th {
    text-align: left;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    font-weight: 600;
    padding: 6px 14px 6px 0;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 8px 14px 8px 0;
    border-bottom: 1px solid var(--line);
    color: var(--text-dim);
    vertical-align: top;
  }
  td:first-child {
    color: var(--text);
    white-space: nowrap;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 8px;
    background: var(--accent);
    vertical-align: middle;
  }

  .i {
    display: inline-block;
    width: 1.4em;
    text-align: center;
  }

  .effects {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .effect {
    display: flex;
    gap: 12px;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .effect > .i {
    flex: none;
    font-size: 18px;
    line-height: 1.4;
  }
  .effect b {
    font-size: 14px;
    color: var(--text);
  }
  .effect p {
    margin-top: 3px;
    font-size: 13px;
    line-height: 1.55;
  }

  .steps {
    margin-top: 14px;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--text-dim);
  }
  .steps li::marker {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .cta {
    margin-top: 48px;
  }
</style>
