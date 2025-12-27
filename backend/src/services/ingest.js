import xlsx from "xlsx";
import path from "path";
import fs from "fs";

export function parseInputFile(filePath, originalName = "") {
  const extSource = originalName || filePath;
  const ext = path.extname(extSource).toLowerCase();
  const workbook = xlsx.readFile(filePath, { raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];

  if (ext !== ".csv" && ext !== ".xlsx" && ext !== ".xls") {
    throw new Error("Unsupported file type. Please upload CSV or XLSX.");
  }

  return { rows, columns, sheetName };
}

export function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    // ignore
  }
}
