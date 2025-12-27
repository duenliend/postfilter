import { runExtractionPhase } from "./extraction.js";
import {
  buildSummaryRequests,
  buildClassificationRequests,
  createBatch,
  pollBatch,
  downloadBatchOutput,
  parseBatchOutput,
  extractMessageContent
} from "./batch.js";
import { persistDataset } from "../store.js";
import { findColumn, TITLE_CANDIDATES, resolveTitleValue } from "../utils/columns.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDismissed(row) {
  return row.dismissed || row.extraction.status === "DISMISSED";
}

function hasFailedExtraction(dataset) {
  return dataset.rows.some((row) => row.extraction.status === "FAILED");
}

function allHaveText(dataset) {
  return dataset.rows.every((row) => {
    if (isDismissed(row)) return true;
    return row.extraction.text && row.extraction.text.trim().length > 0;
  });
}

function normalizeJsonString(text) {
  const trimmed = (text || "").trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(normalizeJsonString(text));
  } catch (error) {
    return null;
  }
}

function applySummaryResult(dataset, result) {
  const row = dataset.rows.find((r) => r.id === result.custom_id);
  if (!row) return;
  const content = extractMessageContent(result);
  const cleaned = normalizeJsonString(content);
  row.summary_structured_json = cleaned;
  const parsed = parseJsonSafely(cleaned);
  if (parsed) {
    if (typeof parsed.summary_fulltext === "string" && parsed.summary_fulltext.trim()) {
      row.summary = parsed.summary_fulltext.trim();
    } else if (Array.isArray(parsed.summary_bullets)) {
      row.summary = parsed.summary_bullets.map((b) => `- ${b}`).join("\n");
    }
  }
}

function applyClassificationResult(dataset, result) {
  const row = dataset.rows.find((r) => r.id === result.custom_id);
  if (!row) return;
  const content = extractMessageContent(result);
  const cleaned = normalizeJsonString(content);
  row.relevance = parseJsonSafely(cleaned) || { raw: cleaned };
}

export function prepareDatasetUrls(dataset, urlColumn) {
  dataset.urlColumn = urlColumn;
  dataset.titleColumn = findColumn(dataset.columns || [], TITLE_CANDIDATES);
  dataset.rows.forEach((row) => {
    const value = row.input[urlColumn];
    row.url = typeof value === "string" ? value.trim() : String(value || "").trim();
    const titleValue = resolveTitleValue(row.input, dataset.titleColumn);
    row.title = titleValue ? String(titleValue).trim() : "";
    row.extraction.status = row.url ? "PENDING" : "FAILED";
    row.extraction.notes = row.url ? "" : "missing_url";
  });
}

async function runSummaryAndClassification(dataset) {
  dataset.error = null;
  dataset.status = "summarizing";
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const targetRows = dataset.rows.filter((row) => !isDismissed(row) && row.extraction.text);
  if (!targetRows.length) {
    dataset.status = "completed";
    return;
  }
  const summaryRequests = buildSummaryRequests(targetRows, model);
  const classificationRequests = buildClassificationRequests(targetRows, model);

  const runBatchStage = async (requests, stage, applyFn) => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const batch = await createBatch(requests, { stage, datasetId: dataset.id });
        const result = await pollBatch(batch.id);
        if (result.status !== "completed") {
          throw new Error(`batch_${stage}_${result.status}`);
        }
        const output = await downloadBatchOutput(result.output_file_id);
        const lines = parseBatchOutput(output.text);
        lines.forEach((line) => applyFn(line));
        persistDataset(dataset);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await delay(3000 * (attempt + 1));
        }
      }
    }
    throw lastError;
  };

  try {
    await runBatchStage(summaryRequests, "summary", (line) => applySummaryResult(dataset, line));
    dataset.status = "classifying";
    await runBatchStage(classificationRequests, "classification", (line) => applyClassificationResult(dataset, line));
    dataset.status = "completed";
    dataset.error = null;
  } catch (error) {
    dataset.status = "error";
    dataset.error = error.message || String(error);
  }
}

export async function resumeAfterManual(dataset) {
  if (!allHaveText(dataset)) {
    dataset.status = "awaiting_manual";
    return;
  }

  return runSummaryAndClassification(dataset);
}

export async function runPipeline(dataset) {
  dataset.status = "extracting";
  await runExtractionPhase(dataset);

  if (hasFailedExtraction(dataset)) {
    dataset.status = "awaiting_manual";
    return;
  }

  if (!allHaveText(dataset)) {
    dataset.status = "awaiting_manual";
    return;
  }

  await runSummaryAndClassification(dataset);
}
