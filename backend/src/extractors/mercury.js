import Mercury from "@postlight/mercury-parser";
import { htmlToText } from "html-to-text";

export async function extractMercury(html, url) {
  try {
    const result = await Mercury.parse(url, { html });
    if (!result || !result.content) {
      return { ok: false, error: "mercury_no_content" };
    }
    const text = htmlToText(result.content, { wordwrap: false });
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: `mercury_error: ${error.message}` };
  }
}
