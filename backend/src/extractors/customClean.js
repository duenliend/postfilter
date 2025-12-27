import { htmlToText } from "html-to-text";

export function extractCustomClean(html) {
  try {
    const text = htmlToText(html, {
      wordwrap: false,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "nav", format: "skip" },
        { selector: "footer", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" }
      ]
    });

    const cleaned = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 40)
      .join("\n\n");

    if (!cleaned) {
      return { ok: false, error: "custom_clean_empty" };
    }

    return { ok: true, text: cleaned };
  } catch (error) {
    return { ok: false, error: `custom_clean_error: ${error.message}` };
  }
}
