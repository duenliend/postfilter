export const TITLE_CANDIDATES = [
  "Article Title",
  "Title",
  "Headline",
  "article_title",
  "headline",
  "title"
];

export function findColumn(columns, candidates) {
  const lowerMap = new Map();
  (columns || []).forEach((col) => {
    if (typeof col === "string") {
      const normalized = col.trim().toLowerCase();
      if (normalized) lowerMap.set(normalized, col);
    }
  });
  for (const candidate of candidates) {
    const match = lowerMap.get(candidate.toLowerCase());
    if (match) return match;
  }
  return "";
}

export function resolveTitleValue(input = {}, titleColumn = "") {
  if (titleColumn && input[titleColumn]) {
    return input[titleColumn];
  }
  const key = Object.keys(input).find((name) => name.toLowerCase().includes("title"));
  if (key && input[key]) {
    return input[key];
  }
  return "";
}
