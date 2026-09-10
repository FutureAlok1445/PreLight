/**
 * core/file-analyzer.js
 * Universal file metadata extraction and action resolution.
 * Reused across the popup, optimizer tab, and content-script upload detector.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const { isSupportedImageType, isSupportedImageFile, classifyMimeType, formatBytes } = Preflight.utils;
  const { MAX_DIMENSION } = Preflight.constants;

  class UnsupportedFileError extends Error {
    constructor(message) {
      super(message);
      this.name = "UnsupportedFileError";
    }
  }

  async function readDimensions(fileOrBlob) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(fileOrBlob);
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dims;
    }
    return await readDimensionsViaImageElement(fileOrBlob);
  }

  function readDimensionsViaImageElement(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const img = new Image();
      img.onload = () => {
        const dims = { width: img.naturalWidth, height: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dims);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not decode this image."));
      };
      img.src = url;
    });
  }

  async function analyzeImage(file) {
    if (!file) throw new UnsupportedFileError("No file provided.");
    if (!isSupportedImageType(file.type, file.name)) {
      throw new UnsupportedFileError("Unsupported image format.");
    }
    if (!isSupportedImageFile(file)) {
      throw new UnsupportedFileError("This image is too large to process safely.");
    }

    const { width, height } = await readDimensions(file);

    if (!width || !height || width > MAX_DIMENSION * 4 || height > MAX_DIMENSION * 4) {
      throw new UnsupportedFileError("Could not read valid dimensions for this image.");
    }

    const normalizedType = (Preflight.utils && Preflight.utils.normalizeMimeType)
      ? Preflight.utils.normalizeMimeType(file.type, file.name)
      : file.type;

    return {
      name: file.name || "image",
      type: normalizedType,
      size: file.size,
      width,
      height,
      megapixels: Number(((width * height) / 1_000_000).toFixed(2))
    };
  }

  /**
   * Universal file analyzer: inspects any file, extracts format-specific
   * metadata, and determines which actions are genuinely supported.
   */
  async function analyzeFile(file) {
    if (!file) throw new UnsupportedFileError("No file provided.");

    const classification = classifyMimeType(file.type, file.name);
    const category = classification.category;
    const baseInfo = {
      name: file.name || "file",
      type: file.type || "",
      category,
      label: classification.label,
      size: file.size,
      formattedSize: formatBytes(file.size),
      supportedActions: []
    };

    if (category === "image" && classification.canProcess) {
      let imgMeta = {};
      try {
        imgMeta = await analyzeImage(file);
      } catch (e) {}
      return Object.assign(baseInfo, imgMeta, {
        supportedActions: ["compress", "resize", "convert", "format", "preview", "copy"]
      });
    }

    if (category === "document" && (file.type === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf"))) {
      let pageCount = 1;
      try {
        if (Preflight.pdfProcessor && typeof Preflight.pdfProcessor.analyzePdf === "function") {
          const pdfInfo = await Preflight.pdfProcessor.analyzePdf(file);
          pageCount = pdfInfo.pageCount;
        }
      } catch (e) {}

      return Object.assign(baseInfo, {
        category: "pdf",
        label: "PDF Document",
        pageCount,
        supportedActions: ["compress", "merge", "split", "preview"]
      });
    }

    if (file.type === "text/csv" || (file.name || "").toLowerCase().endsWith(".csv")) {
      return Object.assign(baseInfo, {
        category: "csv",
        label: "CSV File",
        supportedActions: ["clean", "to_pdf", "convert-to-pdf", "to_json", "csv-to-json", "preview"]
      });
    }

    if ((category === "document" || category === "other") && ((file.type && file.type.startsWith("text/")) || (file.name || "").toLowerCase().endsWith(".txt"))) {
      return Object.assign(baseInfo, {
        category: "text",
        label: "Text File",
        supportedActions: ["clean", "to_pdf", "convert-to-pdf", "preview"]
      });
    }

    if (category === "document") {
      return Object.assign(baseInfo, {
        supportedActions: ["inspect", "review"]
      });
    }

    return Object.assign(baseInfo, {
      supportedActions: ["review"]
    });
  }

  Preflight.fileAnalyzer = {
    analyzeImage,
    analyzeFile,
    readDimensions,
    UnsupportedFileError
  };
})(typeof window !== "undefined" ? window : globalThis);
