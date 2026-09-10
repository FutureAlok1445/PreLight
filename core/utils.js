/**
 * core/utils.js
 * Small, dependency-free helpers shared by every Preflight surface
 * (popup, optimizer tab, and the content-script upload detector).
 *
 * Loaded as a plain classic script (not an ES module) so the same file
 * works unmodified inside a content script's isolated world. Everything
 * is attached to a single global namespace, window.Preflight, to avoid
 * polluting the page and to avoid collisions with host-page globals.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});

  const SUPPORTED_IMAGE_TYPES = Object.freeze([
    "image/png",
    "image/jpeg",
    "image/webp"
  ]);

  // Below this size, optimizing rarely saves anything meaningful.
  const MIN_WORTHWHILE_BYTES = 35 * 1024; // 35 KB

  // A result must beat the original by at least this fraction to count
  // as a real win, otherwise we tell the user it's already optimized.
  const MIN_MEANINGFUL_REDUCTION = 0.08; // 8%

  // Hard safety ceiling so we never try to decode something absurd in a
  // popup/content-script context and hang the tab.
  const MAX_SAFE_BYTES = 45 * 1024 * 1024; // 45 MB

  const MAX_DIMENSION = 8000; // px, safety ceiling for canvas operations

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const decimals = value < 10 ? 2 : value < 100 ? 1 : 0;
    return `${value.toFixed(decimals)} ${units[unitIndex]}`;
  }

  function formatPercent(fraction) {
    if (!Number.isFinite(fraction)) return "0%";
    return `${(fraction * 100).toFixed(1)}%`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }



  function sanitizeFilename(name) {
    return (
      String(name)
        .replace(/[/\\?%*:|"<>]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/-+$/, "")
        .slice(0, 100) || "image"
    );
  }

  function extensionForMime(mime) {
    if (!mime) return "bin";
    const m = mime.toLowerCase().trim();
    switch (m) {
      case "image/webp":
      case "webp":
        return "webp";
      case "image/jpeg":
      case "jpg":
      case "jpeg":
        return "jpg";
      case "image/png":
      case "png":
        return "png";
      case "application/pdf":
      case "pdf":
        return "pdf";
      case "application/json":
      case "json":
        return "json";
      case "text/plain":
      case "txt":
        return "txt";
      case "text/csv":
      case "csv":
        return "csv";
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      case "docx":
        return "docx";
      default: {
        if (!m.includes("/")) return m.replace(/^\./, "");
        const sub = m.split("/")[1] || "bin";
        return sub.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin";
      }
    }
  }

  function normalizeMimeType(type, filename) {
    let t = (type || "").toLowerCase().trim();
    if (t === "image/jpg") t = "image/jpeg";
    if (t && SUPPORTED_IMAGE_TYPES.includes(t)) return t;
    if (filename) {
      const parts = filename.split(".");
      if (parts.length > 1) {
        const ext = parts.pop().toLowerCase();
        if (ext === "png") return "image/png";
        if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
        if (ext === "webp") return "image/webp";
      }
    }
    return t || "";
  }

  function isSupportedImageType(type, filename) {
    const normalized = normalizeMimeType(type, filename);
    return SUPPORTED_IMAGE_TYPES.includes(normalized);
  }

  function isSupportedImageFile(file) {
    if (!file || typeof file.size !== "number" || file.size <= 0 || file.size > MAX_SAFE_BYTES) {
      return false;
    }
    return isSupportedImageType(file.type, file.name);
  }

  /**
   * Produces a safe, predictable "-optimized.<ext>" filename.
   * photo.png -> photo-optimized.webp
   * photo-optimized.png -> photo-optimized.webp (does not compound)
   */
  function buildOutputFilename(originalName, outputMime) {
    const ext = extensionForMime(outputMime);
    const rawBase = sanitizeFilename(stripExtension(originalName || "image"));
    const base = rawBase.replace(/-optimized$/i, "") || "image";
    return `${base}-optimized.${ext}`;
  }

  function stripExtension(name) {
    const idx = name.lastIndexOf(".");
    return idx > 0 ? name.slice(0, idx) : name;
  }

  /** Reads a File/Blob into a base64 data URL (used to hand images between extension contexts). */
  function fileToDataUrl(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Could not read file."));
      reader.readAsDataURL(fileOrBlob);
    });
  }

  /** Reverses fileToDataUrl: turns a data URL back into a File. */
  async function dataUrlToFile(dataUrl, filename, mime) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: mime || blob.type });
  }

  function nowStamp() {
    return new Date().toISOString();
  }

  // ---------- IndexedDB Storage Bridge (eliminates 10 MB session storage quota ceiling) ----------
  const DB_NAME = "PreflightDB";
  const DB_STORE = "handoff";
  const DB_VERSION = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        return reject(new Error("IndexedDB is not available in this context."));
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB."));
    });
  }

  async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.objectStore(DB_STORE).put(value, key);
    });
  }

  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      tx.oncomplete = () => db.close();
      tx.onerror = () => { db.close(); reject(tx.error); };
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbRemove(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.objectStore(DB_STORE).delete(key);
    });
  }

  async function savePending(fileOrBlob, name, type, source) {
    const normalizedType = normalizeMimeType(type, name) || type || "application/octet-stream";
    const item = {
      blob: fileOrBlob,
      name: name || "image",
      type: normalizedType,
      source: source || "import",
      timestamp: Date.now()
    };
    try {
      await idbSet("pending", item);
    } catch (e) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
        const dataUrl = await fileToDataUrl(fileOrBlob);
        await chrome.storage.session.set({ "preflight:pending": { dataUrl, name, type: normalizedType, source } });
      } else {
        throw e;
      }
    }
  }

  async function getPending() {
    try {
      const item = await idbGet("pending");
      if (item && item.blob) {
        await idbRemove("pending");
        return new File([item.blob], item.name, { type: item.type });
      }
    } catch (e) {
      // Fallback to chrome.storage.session
    }

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
      const store = await chrome.storage.session.get("preflight:pending");
      const pending = store["preflight:pending"];
      if (pending) {
        await chrome.storage.session.remove("preflight:pending");
        return await dataUrlToFile(pending.dataUrl, pending.name, pending.type);
      }
    }
    return null;
  }

  async function saveLastResult(result, originalFile) {
    const name = result.alreadyOptimized
      ? originalFile.name
      : buildOutputFilename(originalFile.name, result.format);
    const item = {
      blob: result.blob,
      name,
      size: result.optimizedSize,
      format: result.format,
      alreadyOptimized: result.alreadyOptimized,
      reductionPercent: result.reductionPercent,
      reductionLabel: result.alreadyOptimized ? "already optimized" : `${formatPercent(result.reductionPercent)} smaller`,
      timestamp: Date.now()
    };
    try {
      await idbSet("lastResult", item);
    } catch (e) {}

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
      try {
        await chrome.storage.session.set({
          "preflight:lastResultMeta": {
            name: item.name,
            size: item.size,
            reductionLabel: item.reductionLabel
          }
        });
      } catch (e) {}
    }
  }

  async function getLastResult() {
    try {
      const item = await idbGet("lastResult");
      if (item && item.blob) return item;
    } catch (e) {}

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
      const store = await chrome.storage.session.get("preflight:lastResult");
      const last = store["preflight:lastResult"];
      if (last && last.dataUrl) {
        const res = await fetch(last.dataUrl);
        const blob = await res.blob();
        return {
          blob,
          name: last.name,
          size: last.size,
          reductionLabel: last.reductionLabel
        };
      }
    }
    return null;
  }

  // ---------- File Classification (general file preparation) ----------

  const MIME_CATEGORIES = {
    image: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/svg+xml", "image/tiff"],
    document: ["application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain", "text/csv", "text/html", "application/rtf"],
    video: ["video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-msvideo", "video/x-matroska"],
    audio: ["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/flac", "audio/aac"],
    archive: ["application/zip", "application/x-rar-compressed", "application/gzip",
      "application/x-7z-compressed", "application/x-tar", "application/x-bzip2"]
  };

  const EXT_CATEGORIES = {
    image: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tiff", "tif", "ico"],
    document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt", "ods"],
    video: ["mp4", "webm", "ogv", "mov", "avi", "mkv", "flv", "wmv"],
    audio: ["mp3", "ogg", "wav", "flac", "aac", "m4a", "wma"],
    archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"]
  };

  const MIME_LABELS = {
    "application/pdf": "PDF Document",
    "application/msword": "Word Document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word Document",
    "application/vnd.ms-excel": "Excel Spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel Spreadsheet",
    "application/vnd.ms-powerpoint": "PowerPoint Presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint Presentation",
    "application/zip": "ZIP Archive",
    "application/x-rar-compressed": "RAR Archive",
    "application/gzip": "GZip Archive",
    "application/x-7z-compressed": "7-Zip Archive",
    "text/plain": "Text File",
    "text/csv": "CSV File",
    "text/html": "HTML File",
    "application/rtf": "Rich Text File",
    "image/png": "PNG Image",
    "image/jpeg": "JPEG Image",
    "image/webp": "WebP Image",
    "image/gif": "GIF Image",
    "image/bmp": "Bitmap Image",
    "image/svg+xml": "SVG Image",
    "video/mp4": "MP4 Video",
    "video/webm": "WebM Video",
    "video/quicktime": "QuickTime Video",
    "audio/mpeg": "MP3 Audio",
    "audio/wav": "WAV Audio",
    "audio/flac": "FLAC Audio"
  };

  /**
   * Classifies a file by MIME type and extension.
   * Returns { category: string, canProcess: boolean }
   * canProcess is true only for images PREflight can actually compress.
   */
  function classifyMimeType(type, filename) {
    const t = (type || "").toLowerCase().trim();
    const ext = filename ? (filename.split(".").pop() || "").toLowerCase() : "";
    const label = formatMimeType(type, filename);

    // Check MIME type first
    for (const [cat, types] of Object.entries(MIME_CATEGORIES)) {
      if (types.includes(t)) {
        return {
          category: cat,
          canProcess: cat === "image" && SUPPORTED_IMAGE_TYPES.includes(normalizeMimeType(t, filename)),
          label
        };
      }
    }

    // Fall back to extension
    for (const [cat, exts] of Object.entries(EXT_CATEGORIES)) {
      if (exts.includes(ext)) {
        return {
          category: cat,
          canProcess: cat === "image" && SUPPORTED_IMAGE_TYPES.includes(normalizeMimeType(t, filename)),
          label
        };
      }
    }

    return { category: "other", canProcess: false, label };
  }

  /**
   * Returns a human-readable label for a MIME type.
   * Falls back to cleaned-up MIME string or extension-based guess.
   */
  function formatMimeType(type, filename) {
    const t = (type || "").toLowerCase().trim();
    if (MIME_LABELS[t]) return MIME_LABELS[t];

    // Try extension
    if (filename) {
      const ext = (filename.split(".").pop() || "").toLowerCase();
      if (ext) return `${ext.toUpperCase()} File`;
    }

    // Clean up raw MIME
    if (t) {
      const parts = t.split("/");
      return parts.length > 1 ? parts[1].replace(/[^a-z0-9]/gi, " ").trim() : t;
    }

    return "Unknown File";
  }

  Preflight.constants = {
    SUPPORTED_IMAGE_TYPES,
    MIN_WORTHWHILE_BYTES,
    MIN_MEANINGFUL_REDUCTION,
    MAX_SAFE_BYTES,
    MAX_DIMENSION
  };

  Preflight.utils = {
    formatBytes,
    formatPercent,
    clamp,
    buildOutputFilename,
    sanitizeFilename,
    stripExtension,
    extensionForMime,
    normalizeMimeType,
    isSupportedImageType,
    isSupportedImageFile,
    fileToDataUrl,
    dataUrlToFile,
    nowStamp,
    classifyMimeType,
    formatMimeType
  };

  Preflight.storageBridge = {
    savePending,
    getPending,
    saveLastResult,
    getLastResult
  };
})(typeof window !== "undefined" ? window : globalThis);
