/**
 * Utility functions for the bank-import rule engine.
 *
 * Rules are matched by finding a common token sequence across bank descriptions
 * for the same budget item.  Descriptions are first normalised (lowercase,
 * digits stripped, punctuation removed) before comparison so that things like
 * reference numbers and dates don't prevent a match.
 */

export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\d+/g, ' ')           // strip digit sequences
    .replace(/[^a-z\s]/g, ' ')      // keep only letters and spaces
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim()
}

export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(t => t.length > 1)
}

/**
 * Find the longest token-sequence substring that appears in ALL supplied
 * descriptions (after normalization).  Returns null if no common sequence
 * of at least MIN_PATTERN_LEN characters is found.
 */
const MIN_PATTERN_LEN = 3

export function longestCommonTokenSequence(descriptions: string[]): string | null {
  if (descriptions.length === 0) return null
  if (descriptions.length === 1) {
    const tokens = tokenize(normalizeDescription(descriptions[0]))
    const joined = tokens.join(' ')
    return joined.length >= MIN_PATTERN_LEN ? joined : null
  }

  const normalizedAll = descriptions.map(normalizeDescription)
  const tokenizedAll = normalizedAll.map(tokenize)

  // Use the shortest token list as the candidate source to minimise iterations
  const shortest = tokenizedAll.reduce((a, b) => (a.length <= b.length ? a : b))

  let best = ''

  for (let start = 0; start < shortest.length; start++) {
    for (let end = start + 1; end <= shortest.length; end++) {
      const candidate = shortest.slice(start, end).join(' ')
      if (candidate.length < MIN_PATTERN_LEN) continue
      if (candidate.length <= best.length) continue

      const appearsInAll = normalizedAll.every(norm => norm.includes(candidate))
      if (appearsInAll) {
        best = candidate
      }
    }
  }

  return best.length >= MIN_PATTERN_LEN ? best : null
}

/**
 * Returns true when `bankDescription` matches `pattern`.
 * Both sides are normalised before comparison.
 */
export function matchesRule(bankDescription: string, pattern: string): boolean {
  const normDesc = normalizeDescription(bankDescription)
  const normPat = normalizeDescription(pattern)
  return normDesc.includes(normPat)
}

/**
 * Compute a suggested rule pattern from a list of historical bank descriptions.
 * Returns { pattern, confidence } or null if no common sequence found.
 *
 * confidence = (pattern_length / avg_description_length) capped at 1.0
 */
export function suggestPattern(descriptions: string[]): { pattern: string; confidence: number } | null {
  const pattern = longestCommonTokenSequence(descriptions)
  if (!pattern) return null

  const avgLen =
    descriptions.map(d => normalizeDescription(d).length).reduce((a, b) => a + b, 0) /
    descriptions.length

  const confidence = avgLen > 0 ? Math.min(1, pattern.length / avgLen) : 0

  return { pattern, confidence }
}

/**
 * Tunable constants for the discriminating algorithm.
 */
export const CONFIDENCE_THRESHOLD = 0.3   // below this, Tier 1 triggers Tier 2
export const MIN_POSITIVE_COVERAGE = 0.5  // candidate must appear in ≥50% of positives

/**
 * Discriminating pattern suggestion.
 *
 * Scores every candidate token n-gram from the positive corpus by
 *   score = positive_coverage × (1 − negative_contamination)
 * so that boilerplate appearing in negatives (e.g. "purchase authorized")
 * is penalised in favour of discriminating strings (e.g. "netflix").
 *
 * Falls back to the first high-coverage candidate if all scores are 0
 * (i.e. no negatives available).
 */
export function suggestPatternDiscriminating(
  positives: string[],
  negatives: string[],
): { pattern: string; confidence: number } | null {
  if (positives.length === 0) return null

  const normPos = positives.map(normalizeDescription)
  const normNeg = negatives.map(normalizeDescription)
  const tokenizedPos = normPos.map(tokenize)

  // Collect every unique token n-gram produced from the positive corpus
  const candidateSet = new Set<string>()
  for (const tokens of tokenizedPos) {
    for (let start = 0; start < tokens.length; start++) {
      for (let end = start + 1; end <= tokens.length; end++) {
        const candidate = tokens.slice(start, end).join(' ')
        if (candidate.length >= MIN_PATTERN_LEN) candidateSet.add(candidate)
      }
    }
  }

  let bestPattern = ''
  let bestScore = -1

  for (const candidate of candidateSet) {
    const posHits = normPos.filter(d => d.includes(candidate)).length
    const posCoverage = posHits / normPos.length
    if (posCoverage < MIN_POSITIVE_COVERAGE) continue

    const negHits = normNeg.length > 0 ? normNeg.filter(d => d.includes(candidate)).length : 0
    const negContamination = normNeg.length > 0 ? negHits / normNeg.length : 0

    const score = posCoverage * (1 - negContamination)

    if (
      score > bestScore ||
      (score === bestScore && candidate.length > bestPattern.length)
    ) {
      bestScore = score
      bestPattern = candidate
    }
  }

  if (!bestPattern) return null

  const avgLen = normPos.map(d => d.length).reduce((a, b) => a + b, 0) / normPos.length
  const confidence = avgLen > 0 ? Math.min(1, bestPattern.length / avgLen) : 0

  return { pattern: bestPattern, confidence }
}
