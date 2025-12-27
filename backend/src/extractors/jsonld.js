import * as cheerio from "cheerio";

function collectJsonLd(html) {
  const $ = cheerio.load(html);
  const blocks = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      blocks.push(parsed);
    } catch (error) {
      // ignore
    }
  });
  return blocks;
}

function findArticleBody(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findArticleBody(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    if (node.articleBody) return node.articleBody;
    if (node.mainEntity) return findArticleBody(node.mainEntity);
    if (node.graph) return findArticleBody(node.graph);
    if (node["@graph"]) return findArticleBody(node["@graph"]);
  }
  return null;
}

export function extractJsonLd(html) {
  try {
    const blocks = collectJsonLd(html);
    for (const block of blocks) {
      const body = findArticleBody(block);
      if (body && typeof body === "string") {
        return { ok: true, text: body };
      }
    }
    return { ok: false, error: "jsonld_no_articleBody" };
  } catch (error) {
    return { ok: false, error: `jsonld_error: ${error.message}` };
  }
}
