import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.resolve(".cache");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function hashUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

export function getCachePath(url) {
  ensureCacheDir();
  const hash = hashUrl(url);
  return path.join(CACHE_DIR, `${hash}.json`);
}

export function readCache(url) {
  try {
    const cachePath = getCachePath(url);
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

export function writeCache(url, payload) {
  try {
    const cachePath = getCachePath(url);
    fs.writeFileSync(cachePath, JSON.stringify({
      url,
      cached_at: new Date().toISOString(),
      ...payload
    }));
    return true;
  } catch (error) {
    return false;
  }
}
