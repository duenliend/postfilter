import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

const datasets = new Map();
const DATA_DIR = path.resolve(".cache", "datasets");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function createDataset({ rows, columns, filename, sheetName }) {
  const id = uuidv4();
  const dataset = {
    id,
    filename,
    sheetName,
    columns,
    urlColumn: columns.includes("Article URL") ? "Article URL" : columns[0] || "",
    titleColumn: "",
    createdAt: new Date().toISOString(),
    status: "idle",
    rows: rows.map((row, index) => ({
      id: `row-${index + 1}`,
      input: row,
      url: "",
      title: "",
      dismissed: false,
      extraction: {
        status: "PENDING",
        method: "",
        notes: "",
        text: "",
        wordCount: 0,
        attempts: []
      },
      summary: "",
      summary_structured_json: "",
      relevance: null
    }))
  };

  datasets.set(id, dataset);
  return dataset;
}

export function getDataset(id) {
  return datasets.get(id);
}

export function updateDataset(id, updates) {
  const dataset = datasets.get(id);
  if (!dataset) return null;
  Object.assign(dataset, updates);
  return dataset;
}

export function listDatasets() {
  return Array.from(datasets.values());
}

export function persistDataset(dataset) {
  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, `${dataset.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(dataset, null, 2));
  } catch (error) {
    // ignore persistence failures
  }
}
