import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, "../python/trafilatura_extract.py");

export function runTrafilatura(html) {
  return new Promise((resolve) => {
    const pythonCmd = process.env.TRAFILATURA_PYTHON || "python3";
    const proc = spawn(pythonCmd, [SCRIPT_PATH]);
    let output = "";
    let errorOutput = "";
    let stdinFailed = false;

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });
    proc.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });
    proc.stdin.on("error", () => {
      stdinFailed = true;
    });
    proc.on("close", () => {
      try {
        const parsed = JSON.parse(output.trim());
        if (parsed.ok && parsed.text) {
          resolve({ ok: true, text: parsed.text });
        } else {
          resolve({ ok: false, error: parsed.error || "no_text" });
        }
      } catch (error) {
        resolve({
          ok: false,
          error: errorOutput || (stdinFailed ? "trafilatura_stdin_error" : "invalid_trafilatura_output")
        });
      }
    });

    try {
      proc.stdin.write(html || "");
      proc.stdin.end();
    } catch (error) {
      // ignore EPIPE when python exits early (e.g., trafilatura missing)
    }
  });
}
