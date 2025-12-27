const BOILERPLATE_HINTS = [
  "cookie",
  "subscribe",
  "subscription",
  "sign in",
  "log in",
  "register",
  "advertisement",
  "privacy policy",
  "terms of service",
  "consent",
  "newsletter",
  "accept all"
];

export function normalizeWhitespace(text) {
  return text.replace(/\r/g, "").replace(/\t/g, " ").replace(/\s+$/gm, "").trim();
}

export function splitParagraphs(text) {
  return normalizeWhitespace(text)
    .split(/\n{2,}|\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function wordCount(text) {
  const matches = normalizeWhitespace(text).match(/\b[\p{L}\p{N}']+\b/gu);
  return matches ? matches.length : 0;
}

export function evaluateQuality(text) {
  const normalized = normalizeWhitespace(text);
  const paragraphs = splitParagraphs(normalized);
  const wc = wordCount(normalized);
  const maxParagraphChars = paragraphs.reduce((max, p) => Math.max(max, p.length), 0);

  const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const lineCounts = new Map();
  lines.forEach((line) => {
    lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
  });
  const duplicateLines = Array.from(lineCounts.values()).filter((c) => c > 1).length;
  const lineDupRatio = lines.length ? duplicateLines / lines.length : 0;

  const boilerplateLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    return BOILERPLATE_HINTS.some((hint) => lower.includes(hint));
  }).length;
  const boilerplateRatio = lines.length ? boilerplateLines / lines.length : 0;

  const passes = wc >= 200 && maxParagraphChars >= 100 && lineDupRatio <= 0.35 && boilerplateRatio <= 0.4;

  const reasons = [];
  if (wc < 200) reasons.push("low_word_count");
  if (maxParagraphChars < 100) reasons.push("short_paragraphs");
  if (lineDupRatio > 0.35) reasons.push("duplicate_lines");
  if (boilerplateRatio > 0.4) reasons.push("boilerplate_heavy");

  return {
    normalized,
    paragraphs,
    wordCount: wc,
    maxParagraphChars,
    lineDupRatio,
    boilerplateRatio,
    passes,
    reasons
  };
}

export function shorten(text, maxChars = 2000) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars) + "...";
}
