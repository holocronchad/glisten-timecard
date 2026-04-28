// Roster name-matching for /kiosk/register.
//
// Three-tier match:
//   1. Exact (after normalization) — instant accept. First-token of candidate
//      matches typed first name AND last-token of candidate matches typed
//      last name. Allows middle names ("Joshua James Baer" matches "Joshua
//      Baer"). Reverse order also accepted.
//   2. Suggest — single closest fuzzy candidate within Levenshtein ≤ 2 OR a
//      single roster row whose first name matches the typed first name.
//      Frontend shows "Did you mean X?" before committing.
//   3. None — falls through to the legacy self-register approval flow.
//
// All match logic is pure functions (DB-touching wrapper lives in
// routes/kiosk.ts), unit-tested in __tests__/nameMatch.test.ts.

export type RosterCandidate = {
  id: number;
  name: string;
  aliases: string[];
};

export type MatchResult =
  | { kind: 'exact'; user: RosterCandidate }
  | { kind: 'suggest'; user: RosterCandidate; reason: 'fuzzy' | 'first_name' }
  | { kind: 'multi'; users: RosterCandidate[] }
  | { kind: 'none' };

/** Lowercase, strip accents, drop punctuation, collapse whitespace. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks (accents)
    .replace(/[^a-z0-9 ]+/g, ' ')     // strip apostrophes, hyphens, etc.
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic Levenshtein. O(m*n) DP, fine for ~30 employees × short names. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,    // insertion
        prev[j] + 1,         // deletion
        prev[j - 1] + cost,  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Normalize then split on whitespace, dropping empty tokens. */
function tokens(s: string): string[] {
  return normalizeName(s).split(' ').filter(Boolean);
}

/** First whitespace-separated token of a normalized string. */
export function firstToken(s: string): string {
  const t = tokens(s);
  return t[0] ?? '';
}

/** Every "name form" we'll match against for a single candidate. */
function candidateForms(c: RosterCandidate): string[] {
  return [c.name, ...c.aliases];
}

/** Exact match if first+last typed matches first-token + last-token of a
 *  candidate name (in either order, after normalization). Candidate may have
 *  middle name(s) between the first and last tokens. */
function isExactMatch(
  c: RosterCandidate,
  firstNorm: string,
  lastNorm: string,
): boolean {
  if (!firstNorm || !lastNorm) return false;
  for (const form of candidateForms(c)) {
    const t = tokens(form);
    if (t.length < 2) {
      // Single-token candidate: only matches if either typed token equals it
      // and the other typed token is empty (unlikely path; we require both
      // first and last per the input schema). Skip.
      continue;
    }
    const first = t[0];
    const last = t[t.length - 1];
    // Standard "First Middle? Last" order
    if (first === firstNorm && last === lastNorm) return true;
    // Reverse "Last First" entry order
    if (first === lastNorm && last === firstNorm) return true;
  }
  return false;
}

/**
 * Match a typed first+last name against the roster candidates.
 *
 * `fuzzyThreshold` is the maximum edit distance for a suggest-tier match.
 * Default 2 covers single-character typos + accent flips without
 * over-suggesting on truly different names.
 */
export function matchRoster(
  firstName: string,
  lastName: string,
  candidates: RosterCandidate[],
  fuzzyThreshold = 2,
): MatchResult {
  if (candidates.length === 0) return { kind: 'none' };

  const firstNorm = normalizeName(firstName);
  const lastNorm = normalizeName(lastName);
  const fullTyped = `${firstNorm} ${lastNorm}`.trim();

  // ── Tier 1: Exact (token-based, allows middle names + reversed order)
  const exactMatches = candidates.filter((c) =>
    isExactMatch(c, firstNorm, lastNorm),
  );
  if (exactMatches.length === 1) return { kind: 'exact', user: exactMatches[0] };
  if (exactMatches.length > 1) return { kind: 'multi', users: exactMatches };

  // ── Tier 2a: Fuzzy. Find single closest candidate within threshold.
  // Compare typed full name against each candidate-form's normalized full name.
  let best: { user: RosterCandidate; distance: number } | null = null;
  let bestTie = false;
  for (const c of candidates) {
    let cBest = Infinity;
    for (const form of candidateForms(c)) {
      const formNorm = normalizeName(form);
      if (!formNorm) continue;
      const d = levenshtein(formNorm, fullTyped);
      if (d < cBest) cBest = d;
    }
    if (cBest <= fuzzyThreshold) {
      if (!best || cBest < best.distance) {
        best = { user: c, distance: cBest };
        bestTie = false;
      } else if (cBest === best.distance && best.user.id !== c.id) {
        bestTie = true;
      }
    }
  }
  if (best && !bestTie) {
    return { kind: 'suggest', user: best.user, reason: 'fuzzy' };
  }

  // ── Tier 2b: First-name fallback. If exactly one roster row has a first
  // name (after normalization) matching the typed first name, suggest it.
  // Catches "Annie typed only her first name + a wrong/blank last name."
  if (firstNorm.length >= 2) {
    const firstNameHits = candidates.filter((c) => {
      for (const form of candidateForms(c)) {
        if (firstToken(form) === firstNorm) return true;
      }
      return false;
    });
    if (firstNameHits.length === 1) {
      return { kind: 'suggest', user: firstNameHits[0], reason: 'first_name' };
    }
  }

  return { kind: 'none' };
}
