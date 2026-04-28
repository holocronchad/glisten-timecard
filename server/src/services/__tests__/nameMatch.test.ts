import { describe, it, expect } from 'vitest';
import {
  matchRoster,
  normalizeName,
  levenshtein,
  type RosterCandidate,
} from '../nameMatch';

const ROSTER: RosterCandidate[] = [
  { id: 1, name: 'Annie Simmons', aliases: [] },
  { id: 2, name: 'Aubrey Hanks', aliases: [] },
  { id: 3, name: 'Joshua James Baer', aliases: [] },
  { id: 4, name: 'Maria Yeni Pelayo Rueles', aliases: [] },
  { id: 5, name: 'Jose Garcia', aliases: [] },
  { id: 6, name: 'Cynthia Casas', aliases: ['Cindy Casas'] },
];

describe('normalizeName', () => {
  it('lowercases', () => {
    expect(normalizeName('Annie Simmons')).toBe('annie simmons');
  });
  it('strips accents', () => {
    expect(normalizeName('José García')).toBe('jose garcia');
    expect(normalizeName('Renée O\'Connor')).toBe('renee o connor');
  });
  it('strips punctuation', () => {
    expect(normalizeName('Smith-Jones')).toBe('smith jones');
    expect(normalizeName("O'Reilly, Jr.")).toBe('o reilly jr');
  });
  it('collapses whitespace', () => {
    expect(normalizeName('  Annie    Simmons  ')).toBe('annie simmons');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('annie simmons', 'annie simmons')).toBe(0);
  });
  it('counts single substitution', () => {
    expect(levenshtein('aubrey hanks', 'aubry hanks')).toBe(1);
  });
  it('counts deletion + substitution for nicknames', () => {
    expect(levenshtein('annie simmons', 'anne simmons')).toBe(1); // delete 'i'
    expect(levenshtein('annie simmons', 'ann simmons')).toBe(2); // delete 'i','e'
  });
  it('counts insertions', () => {
    expect(levenshtein('jose garcia', 'jose g garcia')).toBe(2);
  });
  it('handles empty inputs', () => {
    expect(levenshtein('', 'annie')).toBe(5);
    expect(levenshtein('annie', '')).toBe(5);
    expect(levenshtein('', '')).toBe(0);
  });
  it('classic kitten/sitting case', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('matchRoster — exact tier', () => {
  it('matches exact case-insensitive', () => {
    const r = matchRoster('annie', 'simmons', ROSTER);
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.user.id).toBe(1);
  });
  it('matches accents-stripped', () => {
    const r = matchRoster('José', 'García', ROSTER);
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.user.id).toBe(5);
  });
  it('matches first + last when roster name has middle', () => {
    const r = matchRoster('Joshua', 'Baer', ROSTER);
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.user.id).toBe(3);
  });
  it('matches first + last when middle and second-last are present', () => {
    const r = matchRoster('Maria', 'Rueles', ROSTER);
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.user.id).toBe(4);
  });
  it('matches an alias', () => {
    const r = matchRoster('Cindy', 'Casas', ROSTER);
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.user.id).toBe(6);
  });
});

describe('matchRoster — suggest tier', () => {
  it('suggests on single typo (Aubry → Aubrey)', () => {
    const r = matchRoster('Aubry', 'Hanks', ROSTER);
    expect(r.kind).toBe('suggest');
    if (r.kind === 'suggest') {
      expect(r.user.id).toBe(2);
      expect(r.reason).toBe('fuzzy');
    }
  });
  it('suggests on nickname-vs-name (Anne → Annie)', () => {
    const r = matchRoster('Anne', 'Simmons', ROSTER);
    expect(r.kind).toBe('suggest');
    if (r.kind === 'suggest') {
      expect(r.user.id).toBe(1);
      expect(r.reason).toBe('fuzzy');
    }
  });
  it('suggests on first-name-only when first name uniquely identifies', () => {
    const r = matchRoster('Annie', 'XXXX', ROSTER);
    expect(r.kind).toBe('suggest');
    if (r.kind === 'suggest') {
      expect(r.user.id).toBe(1);
      expect(r.reason).toBe('first_name');
    }
  });
});

describe('matchRoster — none / multi', () => {
  it('returns none for very different names', () => {
    const r = matchRoster('Tyrion', 'Lannister', ROSTER);
    expect(r.kind).toBe('none');
  });
  it('returns none when fuzzy distance > threshold', () => {
    // distance from "annette simmons" → "annie simmons" = 3 (replace nett + add i + …)
    const r = matchRoster('Annette', 'Smith', ROSTER); // first-name unique but distance high; first name alone won't match Annie either
    expect(r.kind).toBe('none');
  });
  it('returns multi when more than one exact match', () => {
    const dupes: RosterCandidate[] = [
      { id: 100, name: 'Maria Garcia', aliases: [] },
      { id: 101, name: 'Maria Garcia', aliases: [] },
    ];
    const r = matchRoster('Maria', 'Garcia', dupes);
    expect(r.kind).toBe('multi');
    if (r.kind === 'multi') expect(r.users.length).toBe(2);
  });
  it('returns none when fuzzy ties between two equally-close candidates', () => {
    // Both "Bob" and "Bod" are 1 edit from "Boc" — ambiguous.
    const ties: RosterCandidate[] = [
      { id: 200, name: 'Bob Smith', aliases: [] },
      { id: 201, name: 'Bod Smith', aliases: [] },
    ];
    const r = matchRoster('Boc', 'Smith', ties);
    // Each candidate is distance 1; tie → none rather than guess
    expect(r.kind).toBe('none');
  });
});
