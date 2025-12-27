import unfluff from "unfluff";

export function extractUnfluff(html) {
  try {
    const data = unfluff(html);
    if (!data || !data.text) {
      return { ok: false, error: "unfluff_no_content" };
    }
    return { ok: true, text: data.text };
  } catch (error) {
    return { ok: false, error: `unfluff_error: ${error.message}` };
  }
}
