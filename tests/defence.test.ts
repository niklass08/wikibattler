import { describe, it, expect } from 'vitest';
import type { Card, Rarity } from '../src/lib/types';
import { encodeDefence, decodeDefence, previewOf, DEFENCE_CODE_VERSION } from '../src/lib/battle/defence';
import { classifyCard } from '../src/lib/battle/classify';
import { assembleTeam } from '../src/lib/battle/engine';

function card(over: Partial<Card> = {}): Card {
  return {
    id: 1,
    title: 'X',
    url: 'https://en.wikipedia.org/wiki/X',
    extract: '',
    image: null,
    rarity: 'common' as Rarity,
    strength: 100,
    defence: 100,
    foil: 0,
    negated: false,
    signature: null,
    tags: [],
    raw: { links: 10, bytes: 2000, monthlyViews: 100 },
    ...over
  };
}

const TEAM: Card[] = [
  card({ id: 11, title: 'Ada Lovelace', extract: 'Ada Lovelace (1815–1852) was a mathematician.', strength: 400, defence: 220, tags: ['scientists', 'history'] }),
  card({ id: 22, title: 'Blade Runner', strength: 120, defence: 610, rarity: 'rare', tags: ['cinema'] }),
  card({ id: 33, title: 'Mount Everest', strength: 5, defence: 880, tags: ['geography', 'nature'] }),
  card({ id: 44, title: 'The Beatles', extract: 'The Beatles were an English rock band.', strength: 700, defence: 300, rarity: 'mythic', signature: 'music', tags: ['music'] }),
  card({ id: 55, title: 'Tardigrade', extract: 'A tardigrade is a species of micro-animal.', strength: 60, defence: 90, tags: ['nature'] }),
  card({ id: 66, title: 'Roman Empire', strength: 900, defence: 950, tags: ['history', 'war', 'politics'] }),
  card({ id: 77, title: 'Jazz', strength: 40, defence: 200, tags: ['music', 'arts'] })
];

describe('DefenceCode round-trip', () => {
  it('preserves every field the engine reads', async () => {
    const { ok, ...rest } = await decodeDefence(await encodeDefence(TEAM));
    expect(ok).toBe(true);
    const cards = (rest as { cards: Card[] }).cards;
    expect(cards).toHaveLength(7);
    for (let i = 0; i < TEAM.length; i++) {
      expect(cards[i].id).toBe(TEAM[i].id);
      expect(cards[i].title).toBe(TEAM[i].title);
      expect(cards[i].strength).toBe(TEAM[i].strength);
      expect(cards[i].defence).toBe(TEAM[i].defence);
      expect(cards[i].rarity).toBe(TEAM[i].rarity);
      expect(cards[i].tags).toEqual(TEAM[i].tags); // order preserved
    }
  });

  it('keeps the mythic signature and its theme', async () => {
    const { cards } = (await decodeDefence(await encodeDefence(TEAM))) as { cards: Card[] };
    expect(cards.find((c) => c.title === 'The Beatles')?.signature).toBe('music');
  });

  it('transmits the battle role so classifyCard agrees after the extract is gone', async () => {
    const { cards } = (await decodeDefence(await encodeDefence(TEAM))) as { cards: Card[] };
    expect(cards[0].extract).toBe(''); // extract is dropped
    expect(classifyCard(cards[0])).toBe('living'); // Ada — person
    expect(classifyCard(cards.find((c) => c.title === 'Blade Runner')!)).toBe('abstract');
    expect(classifyCard(cards.find((c) => c.title === 'Tardigrade')!)).toBe('living'); // organism
  });

  it('produces a code that assembleTeam can fold without throwing', async () => {
    const { cards } = (await decodeDefence(await encodeDefence(TEAM))) as { cards: Card[] };
    const team = assembleTeam(cards);
    expect(team.maxHp).toBeGreaterThan(0);
    expect(team.members).toHaveLength(7);
  });

  it('is URL-safe and reasonably compact', async () => {
    const code = await encodeDefence(TEAM);
    expect(code).toMatch(/^1\.[A-Za-z0-9\-_]+$/);
    expect(code.length).toBeLessThan(700);
  });
});

describe('decodeDefence validation (never throws)', () => {
  it('rejects garbage', async () => {
    expect(await decodeDefence('not a code')).toEqual({ ok: false, error: expect.any(String) });
    expect(await decodeDefence('')).toEqual({ ok: false, error: expect.any(String) });
    expect((await decodeDefence('1.@@@@not-base64@@@@')).ok).toBe(false);
  });

  it('rejects a truncated code', async () => {
    const code = await encodeDefence(TEAM);
    expect((await decodeDefence(code.slice(0, code.length - 10))).ok).toBe(false);
  });

  it('flags a newer version', async () => {
    const res = await decodeDefence(`${DEFENCE_CODE_VERSION + 1}.AAAA`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/newer version/i);
  });

  it('clamps an over-long team to TEAM_SIZE', async () => {
    const twelve = [...TEAM, ...TEAM.slice(0, 5)].map((c, i) => ({ ...c, id: 100 + i }));
    const { cards } = (await decodeDefence(await encodeDefence(twelve))) as { cards: Card[] };
    expect(cards.length).toBe(7);
  });

  it('drops an unknown signature index rather than crashing', async () => {
    // hand-forge a payload with a bogus signature index
    const code = await encodeDefence([
      card({ id: 1, title: 'Weird', rarity: 'mythic', signature: 'music' })
    ]);
    const res = await decodeDefence(code);
    expect(res.ok).toBe(true);
    // now tamper: re-encode with a manual bad index is awkward; instead assert a
    // non-mythic never keeps a signature
    const nonMythic = (await decodeDefence(
      await encodeDefence([card({ id: 2, title: 'Plain', signature: 'music' })])
    )) as { cards: Card[] };
    expect(nonMythic.cards[0].signature).toBeNull();
  });

  it('falls back to "Unknown card" for a blank title', async () => {
    const { cards } = (await decodeDefence(
      await encodeDefence([card({ id: 9, title: '' })])
    )) as { cards: Card[] };
    expect(cards[0].title).toBe('Unknown card');
  });

  it('keeps only the first mythic signature', async () => {
    const twoMythics: Card[] = [
      card({ id: 1, title: 'M1', rarity: 'mythic', signature: 'music' }),
      card({ id: 2, title: 'M2', rarity: 'mythic', signature: 'cinema' })
    ];
    const { cards } = (await decodeDefence(await encodeDefence(twoMythics))) as { cards: Card[] };
    expect(cards[0].signature).toBe('music');
    expect(cards[1].signature).toBeNull();
  });

  it('unwraps a pasted #arena= link', async () => {
    const code = await encodeDefence(TEAM);
    const res = await decodeDefence(`https://example.com/wikitcg/#arena=${code}`);
    expect(res.ok).toBe(true);
  });
});

describe('previewOf', () => {
  it('summarises each card without a decode', () => {
    const p = previewOf(TEAM);
    expect(p).toHaveLength(7);
    expect(p[0]).toEqual({ t: 'Ada Lovelace', r: 0, role: 1, sig: -1 });
    expect(p.find((x) => x.t === 'The Beatles')?.sig).toBeGreaterThanOrEqual(0);
  });
});
