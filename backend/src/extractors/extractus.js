import { extractFromHtml } from "@extractus/article-extractor";
import { htmlToText } from "html-to-text";

export async function extractExtractus(html, url) {
  try {
    const article = await extractFromHtml(html, url);
    if (!article || !article.content) {
      return { ok: false, error: "extractus_no_content" };
    }
    const text = htmlToText(article.content, { wordwrap: false });
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: `extractus_error: ${error.message}` };
  }
}
