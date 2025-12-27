import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export function extractReadability(html, url) {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.textContent) {
    return { ok: false, error: "readability_no_content" };
  }
  return { ok: true, text: article.textContent };
}
