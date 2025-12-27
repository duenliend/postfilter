import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { parseInputFile, removeFile } from "./services/ingest.js";
import { createDataset, getDataset, persistDataset } from "./store.js";
import { prepareDatasetUrls, runPipeline, resumeAfterManual } from "./services/pipeline.js";
import { buildWorkbook, writeWorkbookBuffer } from "./services/export.js";
import { findColumn, TITLE_CANDIDATES, resolveTitleValue } from "./utils/columns.js";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const uploadDir = path.resolve("uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    const { rows, columns, sheetName } = parseInputFile(req.file.path, req.file.originalname);
    const dataset = createDataset({ rows, columns, filename: req.file.originalname, sheetName });
    removeFile(req.file.path);

    return res.json({
      datasetId: dataset.id,
      columns: dataset.columns,
      urlColumn: dataset.urlColumn,
      rowCount: dataset.rows.length,
      preview: dataset.rows.slice(0, 5).map((row) => row.input)
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/start", async (req, res) => {
  const { datasetId, urlColumn } = req.body || {};
  const dataset = getDataset(datasetId);
  if (!dataset) {
    return res.status(404).json({ error: "Dataset not found." });
  }
  if (!urlColumn) {
    return res.status(400).json({ error: "urlColumn is required." });
  }

  prepareDatasetUrls(dataset, urlColumn);
  if (!["idle", "error"].includes(dataset.status)) {
    return res.json({ status: dataset.status });
  }

  dataset.status = "running";
  runPipeline(dataset).catch((error) => {
    dataset.status = "error";
    dataset.error = error.message;
  });

  return res.json({ status: dataset.status });
});

app.get("/api/status", (req, res) => {
  const { datasetId } = req.query;
  const dataset = getDataset(datasetId);
  if (!dataset) {
    return res.status(404).json({ error: "Dataset not found." });
  }

  const titleColumn = findColumn(dataset.columns || [], TITLE_CANDIDATES);

  return res.json({
    id: dataset.id,
    status: dataset.status,
    urlColumn: dataset.urlColumn,
    rowCount: dataset.rows.length,
    error: dataset.error || null,
    rows: dataset.rows.map((row) => {
      const fallbackUrl = dataset.urlColumn ? row.input[dataset.urlColumn] : "";
      const resolvedUrl = row.url || (fallbackUrl ? String(fallbackUrl).trim() : "");
      const titleValue =
        row.title ||
        resolveTitleValue(row.input, titleColumn);
      return {
        id: row.id,
        url: resolvedUrl,
        title: titleValue ? String(titleValue).trim() : "",
        extraction_status: row.extraction.status,
        extraction_method: row.extraction.method,
        extraction_notes: row.extraction.notes,
        summary: row.summary,
        coding_relevant: row.relevance?.coding_relevant,
        needs_manual_review: row.relevance?.needs_manual_review,
        log: row.extraction.attempts
      };
    })
  });
});

app.post("/api/manual", async (req, res) => {
  const { datasetId, items } = req.body || {};
  const dataset = getDataset(datasetId);
  if (!dataset) {
    return res.status(404).json({ error: "Dataset not found." });
  }
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "items must be an array." });
  }

  items.forEach(({ id, text, dismissed, titleOnly }) => {
    const row = dataset.rows.find((r) => r.id === id);
    if (!row) return;
    if (dismissed) {
      row.dismissed = true;
      row.extraction.status = "DISMISSED";
      row.extraction.text = "";
      row.extraction.method = "dismissed";
      row.extraction.notes = "dismissed_by_user";
      return;
    }
    if (titleOnly) {
      const fallbackTitle =
        row.title ||
        resolveTitleValue(row.input, dataset.titleColumn) ||
        row.input[dataset.urlColumn] ||
        row.url ||
        row.id;
      const payload = fallbackTitle ? String(fallbackTitle).trim() : "";
      if (payload) {
        row.extraction.status = "MANUAL";
        row.extraction.text = payload;
        row.extraction.method = "title_only";
        row.extraction.notes = "title_only";
      }
      return;
    }
    if (!text || !text.trim()) return;
    row.extraction.status = "MANUAL";
    row.extraction.text = text.trim();
    row.extraction.method = "manual";
    row.extraction.notes = "manual_paste";
  });
  persistDataset(dataset);

  if (dataset.status !== "running") {
    dataset.status = "running";
    resumeAfterManual(dataset).catch((error) => {
      dataset.status = "error";
      dataset.error = error.message;
    });
  }

  return res.json({ status: dataset.status });
});

app.get("/api/export", (req, res) => {
  const { datasetId } = req.query;
  const dataset = getDataset(datasetId);
  if (!dataset) {
    return res.status(404).json({ error: "Dataset not found." });
  }

  const workbook = buildWorkbook(dataset);
  const buffer = writeWorkbookBuffer(workbook);
  const filename = dataset.filename ? dataset.filename.replace(/\.[^/.]+$/, "") + "_enriched.xlsx" : "enriched.xlsx";

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  res.send(buffer);
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
