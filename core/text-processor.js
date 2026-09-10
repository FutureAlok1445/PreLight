/**
 * core/text-processor.js
 * Local analysis and cleaning for Text and CSV files.
 * Provides delimiter detection, structure stats, whitespace minification,
 * CSV-to-JSON conversion, and export to PDF.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});

  async function readText(fileOrBlob) {
    if (typeof fileOrBlob.text === "function") {
      return await fileOrBlob.text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Failed to read text file."));
      reader.readAsText(fileOrBlob, "utf-8");
    });
  }

  /**
   * Analyzes text or CSV file structure.
   */
  async function analyzeText(fileOrBlob) {
    const content = await readText(fileOrBlob);
    const normalized = content.replace(/\r\n/g, "\n");
    const rawLines = normalized.split("\n");
    const lineCount = normalized.endsWith("\n") && rawLines.length > 1 ? rawLines.length - 1 : rawLines.length;
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const charCount = content.length;

    const isCsv = detectIsCsv(fileOrBlob.name || "", content);
    let csvDetails = null;

    if (isCsv) {
      csvDetails = detectCsvStructure(rawLines);
    }

    return {
      size: fileOrBlob.size,
      lineCount,
      lines: lineCount,
      wordCount,
      words: wordCount,
      charCount,
      characters: charCount,
      isCsv,
      csvDetails,
      delimiter: csvDetails ? csvDetails.delimiter : null
    };
  }

  function detectIsCsv(filename, content) {
    if (filename.toLowerCase().endsWith(".csv")) return true;
    const firstFewLines = content.slice(0, 1000);
    return /[,;\t|]/.test(firstFewLines) && firstFewLines.includes("\n");
  }

  function detectCsvStructure(lines) {
    const delimiters = [",", ";", "\t", "|"];
    const counts = {};
    const sample = lines.slice(0, 10).filter((l) => l.trim().length > 0);

    for (const d of delimiters) {
      counts[d] = sample.map((line) => (line.split(d).length - 1));
    }

    // Pick delimiter with consistent non-zero counts
    let bestDelim = ",";
    let maxConsistency = -1;

    for (const d of delimiters) {
      const arr = counts[d];
      if (arr.length > 0 && arr[0] > 0) {
        const consistent = arr.every((c) => c === arr[0]);
        if (consistent && arr[0] > maxConsistency) {
          bestDelim = d;
          maxConsistency = arr[0];
        }
      }
    }

    const rowCount = lines.filter((l) => l.trim().length > 0).length;
    const colCount = maxConsistency > 0 ? maxConsistency + 1 : 1;

    const delimNames = { ",": "Comma (,)", ";": "Semicolon (;)", "\t": "Tab", "|": "Pipe (|)" };

    return {
      delimiter: bestDelim,
      delimiterName: delimNames[bestDelim] || bestDelim,
      rowCount,
      colCount
    };
  }

  /**
   * Cleans text/CSV: strips trailing spaces, removes empty rows, normalizes line breaks.
   */
  async function cleanText(fileOrBlob) {
    const raw = await readText(fileOrBlob);
    const originalSize = fileOrBlob.size;

    const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const cleanedLines = [];

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.length > 0) {
        cleanedLines.push(trimmed);
      }
    }

    const cleanedText = cleanedLines.join("\n") + "\n";
    const blob = new Blob([cleanedText], { type: fileOrBlob.type || "text/plain" });

    return {
      blob,
      originalSize,
      optimizedSize: blob.size,
      reductionPercent: originalSize > 0 ? Math.max(0, (originalSize - blob.size) / originalSize) : 0,
      alreadyOptimized: blob.size >= originalSize,
      lineCount: cleanedLines.length
    };
  }

  /**
   * Converts CSV text to JSON array.
   */
  async function csvToJson(fileOrBlob) {
    const content = await readText(fileOrBlob);
    const lines = content.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return new Blob(["[]"], { type: "application/json" });

    const structure = detectCsvStructure(lines);
    const delim = structure.delimiter;

    const headers = lines[0].split(delim).map((h) => h.trim().replace(/^["']|["']$/g, ""));
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delim).map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const row = {};
      headers.forEach((h, idx) => {
        row[h || `col_${idx + 1}`] = cols[idx] !== undefined ? cols[idx] : "";
      });
      data.push(row);
    }

    return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  }

  Preflight.textProcessor = {
    readText,
    analyzeText,
    cleanText,
    csvToJson
  };
})(typeof window !== "undefined" ? window : globalThis);
