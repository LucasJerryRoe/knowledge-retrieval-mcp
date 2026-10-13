const WORD_PATTERN = /[\p{L}\p{N}_]+/gu;
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

export function tokenize(input: string): string[] {
  const normalized = input.trim().toLocaleLowerCase();
  if (!normalized) return [];

  const tokens = new Set<string>();
  for (const match of normalized.matchAll(WORD_PATTERN)) {
    const word = match[0];
    if (!CJK_PATTERN.test(word)) {
      tokens.add(word);
    }
    CJK_PATTERN.lastIndex = 0;
  }

  for (const match of normalized.matchAll(CJK_PATTERN)) {
    const sequence = [...match[0]];
    if (sequence.length === 1) tokens.add(sequence[0]);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(`${sequence[index]}${sequence[index + 1]}`);
    }
  }

  if (CJK_PATTERN.test(normalized)) tokens.add(normalized);
  CJK_PATTERN.lastIndex = 0;
  return [...tokens];
}
