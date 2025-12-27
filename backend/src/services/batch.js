import fs from "fs";
import path from "path";
import undici from "undici";
import { shorten } from "../utils/text.js";

const { fetch, FormData } = undici;
const BlobCtor = typeof Blob !== "undefined" ? Blob : undici.Blob;
const OPENAI_BASE_URL = "https://api.openai.com";

function requireApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  return apiKey;
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`
  };
}

export function buildSummaryRequests(rows, model) {
  const systemPrompt =
    "Summarise the provided article text in English in at most 4 sentences and output valid JSON with a single field: summary_fulltext (the 4-sentence summary).";

  return rows.map((row) => ({
    custom_id: row.id,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: row.extraction?.text || "" }
      ]
    }
  }));
}

export function buildClassificationRequests(rows, model) {
  const systemPrompt = [
    "You are classifying coding relevance for Leeds Index PE coding.",
    "Use only the provided detailed summary bullets; do not invent facts.",
    "Set coding_relevant true only if a PE occurred and all four criteria are evidenced.",
    "If under-specified but plausible, set needs_manual_review true.",
    "Reason must be a concise one-sentence justification for TRUE or FALSE.",
    "Output valid JSON with fields: coding_relevant, relevance_confidence, reason, pe_count_estimate, pe_types, needs_manual_review, notes_for_coder."
  ].join(" ");

  return rows.map((row) => {
    const summary = row.summary || "";
    const userContent = ["Summary bullets:", summary].join("\n");

    return {
      custom_id: row.id,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ]
      }
    };
  });
}

function buildJsonl(requests) {
  return requests.map((req) => JSON.stringify(req)).join("\n") + "\n";
}

async function withRetry(fn, attempts = 5, delayMs = 2000) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
          const backoff = delayMs * Math.pow(1.5, i);
          await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

export async function createBatch(requests, metadata = {}) {
  const apiKey = requireApiKey();
  const jsonl = buildJsonl(requests);
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new BlobCtor([jsonl], { type: "application/jsonl" }), "batch.jsonl");

  const uploadData = await withRetry(async () => {
    const uploadRes = await fetch(`${OPENAI_BASE_URL}/v1/files`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: form
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`OpenAI file upload failed: ${uploadRes.status} ${text}`);
    }
    return uploadRes.json();
  }, 3, 1500);

  const batchData = await withRetry(async () => {
    const batchRes = await fetch(`${OPENAI_BASE_URL}/v1/batches`, {
      method: "POST",
      headers: {
        ...authHeaders(apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input_file_id: uploadData.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
        metadata
      })
    });
    if (!batchRes.ok) {
      const text = await batchRes.text();
      throw new Error(`OpenAI batch create failed: ${batchRes.status} ${text}`);
    }
    return batchRes.json();
  }, 3, 1500);

  return batchData;
}

export async function pollBatch(batchId, intervalMs = 5000, maxMinutes = 60) {
  const apiKey = requireApiKey();
  const maxTime = Date.now() + maxMinutes * 60 * 1000;

  while (Date.now() < maxTime) {
    const res = await fetch(`${OPENAI_BASE_URL}/v1/batches/${batchId}`, {
      headers: authHeaders(apiKey)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI batch poll failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    if (["completed", "failed", "expired", "cancelled"].includes(data.status)) {
      return data;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("OpenAI batch polling timed out.");
}

export async function downloadBatchOutput(fileId, outputDir = ".cache") {
  const apiKey = requireApiKey();
  const res = await fetch(`${OPENAI_BASE_URL}/v1/files/${fileId}/content`, {
    headers: authHeaders(apiKey)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI output download failed: ${res.status} ${text}`);
  }

  const text = await res.text();
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, `${fileId}.jsonl`);
  fs.writeFileSync(filePath, text);
  return { filePath, text };
}

export function parseBatchOutput(jsonlText) {
  return jsonlText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

export function extractMessageContent(result) {
  const body = result?.response?.body;
  const choice = body?.choices?.[0];
  return choice?.message?.content || "";
}
