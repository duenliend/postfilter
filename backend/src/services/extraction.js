import undici from "undici";
import PQueue from "p-queue";
import { evaluateQuality, normalizeWhitespace } from "../utils/text.js";
import { readCache, writeCache } from "../utils/cache.js";
import { runTrafilatura } from "../extractors/trafilatura.js";
import { extractReadability } from "../extractors/readability.js";
import { extractExtractus } from "../extractors/extractus.js";
import { extractMercury } from "../extractors/mercury.js";
import { extractUnfluff } from "../extractors/unfluff.js";
import { extractJsonLd } from "../extractors/jsonld.js";
import { extractCustomClean } from "../extractors/customClean.js";
import { persistDataset } from "../store.js";

const { fetch } = undici;
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

const SOFT_BLOCK_HINTS = [
  "captcha",
  "cloudflare",
  "attention required",
  "enable javascript",
  "access denied",
  "subscribe to continue",
  "sign in to continue",
  "paywall",
  "your browser is out of date"
];

const fetchConcurrency = Number(process.env.DIRECT_FETCH_CONCURRENCY || 10);
const playwrightConcurrency = Number(process.env.PLAYWRIGHT_CONCURRENCY || 2);
const pythonConcurrency = Number(process.env.PYTHON_CONCURRENCY || 4);
const fetchTimeoutMs = Number(process.env.FETCH_TIMEOUT_MS || 25000);
const playwrightTimeoutMs = Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 60000);
const enablePlaywright = String(process.env.ENABLE_PLAYWRIGHT || "false").toLowerCase() === "true";

const rowQueue = new PQueue({ concurrency: fetchConcurrency });
const playwrightQueue = new PQueue({ concurrency: playwrightConcurrency });
const pythonQueue = new PQueue({ concurrency: pythonConcurrency });

function detectSoftBlock(html) {
  const lower = html.toLowerCase();
  return SOFT_BLOCK_HINTS.some((hint) => lower.includes(hint));
}

function extractAmpUrl(html, baseUrl) {
  const match = html.match(/<link[^>]+rel=["']amphtml["'][^>]+href=["']([^"']+)["']/i);
  if (!match) return null;
  try {
    return new URL(match[1], baseUrl).toString();
  } catch (error) {
    return null;
  }
}

async function fetchHtml(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const res = await fetch(url, {
        headers: DEFAULT_HEADERS,
        redirect: "follow",
        signal: controller.signal
      });
      const contentType = res.headers.get("content-type") || "";
      const html = await res.text();
      const ok = res.ok && html;
      if (ok || res.status < 500) {
        return {
          ok: res.ok,
          status: res.status,
          html,
          contentType
        };
      }
      lastError = `status_${res.status}`;
    } catch (error) {
      lastError = error.message;
    } finally {
      clearTimeout(timeout);
    }

    const backoff = 500 * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  return { ok: false, status: 0, html: "", error: lastError || "fetch_failed" };
}

async function fetchHtmlWithPlaywright(url) {
  if (!enablePlaywright) return null;
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (error) {
    return null;
  }

  return playwrightQueue.add(async () => {
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: DEFAULT_HEADERS["User-Agent"] });
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: playwrightTimeoutMs });
      const html = await page.content();
      await browser.close();
      return html;
    } catch (error) {
      await browser.close();
      return null;
    }
  });
}

async function runExtractor(label, extractorFn, html, url, row) {
  try {
    const result = await extractorFn(html, url);
    if (!result.ok || !result.text) {
      row.extraction.attempts.push({ method: label, ok: false, error: result.error || "no_text" });
      return null;
    }

    const quality = evaluateQuality(result.text);
    row.extraction.attempts.push({
      method: label,
      ok: quality.passes,
      wordCount: quality.wordCount,
      reasons: quality.reasons
    });

    if (quality.passes) {
      return {
        text: normalizeWhitespace(result.text),
        method: label,
        notes: quality.reasons.length ? quality.reasons.join(",") : "ok",
        wordCount: quality.wordCount
      };
    }
  } catch (error) {
    row.extraction.attempts.push({ method: label, ok: false, error: error.message });
  }
  return null;
}

async function runExtractorSync(label, extractorFn, html, row) {
  try {
    const result = extractorFn(html);
    if (!result.ok || !result.text) {
      row.extraction.attempts.push({ method: label, ok: false, error: result.error || "no_text" });
      return null;
    }

    const quality = evaluateQuality(result.text);
    row.extraction.attempts.push({
      method: label,
      ok: quality.passes,
      wordCount: quality.wordCount,
      reasons: quality.reasons
    });

    if (quality.passes) {
      return {
        text: normalizeWhitespace(result.text),
        method: label,
        notes: quality.reasons.length ? quality.reasons.join(",") : "ok",
        wordCount: quality.wordCount
      };
    }
  } catch (error) {
    row.extraction.attempts.push({ method: label, ok: false, error: error.message });
  }
  return null;
}

async function runTrafilaturaQueued(html, row) {
  return pythonQueue.add(async () => {
    const result = await runTrafilatura(html);
    if (!result.ok || !result.text) {
      row.extraction.attempts.push({ method: "trafilatura", ok: false, error: result.error || "no_text" });
      return null;
    }

    const quality = evaluateQuality(result.text);
    row.extraction.attempts.push({
      method: "trafilatura",
      ok: quality.passes,
      wordCount: quality.wordCount,
      reasons: quality.reasons
    });

    if (quality.passes) {
      return {
        text: normalizeWhitespace(result.text),
        method: "trafilatura",
        notes: quality.reasons.length ? quality.reasons.join(",") : "ok",
        wordCount: quality.wordCount
      };
    }

    return null;
  });
}

async function extractFromHtml(html, url, row) {
  const attempts = [
    async () => runTrafilaturaQueued(html, row),
    async () => runExtractor("readability", (h, u) => extractReadability(h, u), html, url, row),
    async () => runExtractor("extractus", extractExtractus, html, url, row),
    async () => runExtractor("mercury", extractMercury, html, url, row),
    async () => runExtractorSync("unfluff", extractUnfluff, html, row),
    async () => runExtractorSync("jsonld", extractJsonLd, html, row),
    async () => runExtractorSync("custom_clean", extractCustomClean, html, row)
  ];

  for (const attempt of attempts) {
    const result = await attempt();
    if (result && result.text) {
      return result;
    }
  }

  return null;
}

async function buildHtmlCandidates(url, row) {
  const candidates = [];
  const direct = await fetchHtml(url);
  if (direct.html) {
    candidates.push({ html: direct.html, source: "direct" });
    if (!direct.ok) {
      row.extraction.attempts.push({ method: "fetch_direct", ok: false, error: `status_${direct.status}` });
    } else {
      row.extraction.attempts.push({ method: "fetch_direct", ok: true });
    }

    const ampUrl = extractAmpUrl(direct.html, url);
    if (ampUrl) {
      const amp = await fetchHtml(ampUrl);
      if (amp.html) {
        candidates.push({ html: amp.html, source: "amp" });
        row.extraction.attempts.push({ method: "fetch_amp", ok: amp.ok, error: amp.ok ? null : `status_${amp.status}` });
      }
    }

    const blocked = detectSoftBlock(direct.html);
    if (blocked || direct.html.length < 2000) {
      const rendered = await fetchHtmlWithPlaywright(url);
      if (rendered) {
        candidates.push({ html: rendered, source: "playwright" });
        row.extraction.attempts.push({ method: "fetch_playwright", ok: true });
      } else if (enablePlaywright) {
        row.extraction.attempts.push({ method: "fetch_playwright", ok: false, error: "playwright_failed" });
      }
    }
  } else if (enablePlaywright) {
    const rendered = await fetchHtmlWithPlaywright(url);
    if (rendered) {
      candidates.push({ html: rendered, source: "playwright" });
      row.extraction.attempts.push({ method: "fetch_playwright", ok: true });
    } else {
      row.extraction.attempts.push({ method: "fetch_playwright", ok: false, error: "playwright_failed" });
    }
  }

  return candidates;
}

export async function processRow(row) {
  if (row.dismissed || row.extraction.status === "DISMISSED") {
    return;
  }
  const cached = readCache(row.url);
  if (cached && cached.extracted_text) {
    row.extraction.status = "OK";
    row.extraction.method = cached.method || "cache";
    row.extraction.notes = "cache_hit";
    row.extraction.text = cached.extracted_text;
    row.extraction.wordCount = cached.word_count || 0;
    return;
  }

  const candidates = await buildHtmlCandidates(row.url, row);
  for (const candidate of candidates) {
    const result = await extractFromHtml(candidate.html, row.url, row);
    if (result && result.text) {
      row.extraction.status = "OK";
      row.extraction.method = result.method;
      row.extraction.notes = `${candidate.source}`;
      row.extraction.text = result.text;
      row.extraction.wordCount = result.wordCount;
      writeCache(row.url, {
        html: candidate.html,
        extracted_text: result.text,
        method: result.method,
        word_count: result.wordCount
      });
      return;
    }
  }

  row.extraction.status = "FAILED";
  row.extraction.method = "";
  row.extraction.notes = "extraction_failed";
}

export async function runExtractionPhase(dataset) {
  const tasks = dataset.rows.map((row) => rowQueue.add(async () => {
    if (row.extraction.status === "FAILED" && row.extraction.notes === "missing_url") {
      return;
    }
    if (row.dismissed || row.extraction.status === "DISMISSED") {
      return;
    }
    row.extraction.status = "RUNNING";
    row.extraction.attempts = row.extraction.attempts || [];
    await processRow(row);
  }));

  await Promise.all(tasks);
  persistDataset(dataset);
}
