/**
 * upload/upload-detector.js
 * Watches for file selection on standard <input type="file"> elements on ANY website.
 * Activates the 2-step PREflight Review and Preparation interface before upload proceeds.
 *
 * Supported workflows:
 *  - Images (PNG, JPEG, WebP): dynamic local compression, format conversion, resize.
 *  - PDFs: local stream compression and multi-PDF merging.
 *  - Text & CSV: structure analysis, empty line / trailing whitespace cleaning.
 *  - Other files: verified file review gate (name, type, size).
 *  - Never auto-uploads -- requires explicit user confirmation.
 */
(function (global) {
  "use strict";

  if (global.__preflightUploadDetectorInstalled) return;
  global.__preflightUploadDetectorInstalled = true;

  const Preflight = global.Preflight;
  const { isSupportedImageFile, buildOutputFilename, formatBytes } = Preflight.utils;
  const { analyzeFile } = Preflight.fileAnalyzer;
  const { determineStrategy } = Preflight.smartProfile;
  const { optimizeImage } = Preflight.imageOptimizer;

  const LIMIT_PATTERN = /max(?:imum)?\s*(?:file\s*)?size[^\n\d]{0,15}(\d+(?:\.\d+)?)\s*(kb|mb)\b/i;

  let settingsCache = { uploadOptimizerEnabled: true };
  const openOverlays = new WeakMap();

  init();

  function init() {
    document.addEventListener("change", handleChange, true);

    safeGetSettings().then((settings) => {
      settingsCache = settings;
    });

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes["preflight:settings"]) {
          settingsCache = Object.assign({}, settingsCache, changes["preflight:settings"].newValue);
        }
      });
    }
  }

  async function safeGetSettings() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const store = await chrome.storage.local.get("preflight:settings");
        return store["preflight:settings"] || { uploadOptimizerEnabled: true };
      }
    } catch (err) {}
    return { uploadOptimizerEnabled: true };
  }

  function handleChange(event) {
    if (settingsCache && settingsCache.uploadOptimizerEnabled === false) return;

    const input = (event.composedPath && event.composedPath()[0]) || event.target;
    if (!input || (input.tagName !== "INPUT" && !(input instanceof HTMLInputElement)) || (input.type || "").toLowerCase() !== "file") return;

    if (input.dataset.preflightBypass === "1") {
      delete input.dataset.preflightBypass;
      return;
    }

    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    event.stopImmediatePropagation();

    handleSelection(input, files).catch((err) => {
      console.error("PREFLIGHT SELECTION ERR:", err);
      releaseOriginal(input);
    });
  }

  async function handleSelection(input, files) {
    const existing = openOverlays.get(input);
    if (existing) existing.close();

    const limitBytes = detectUploadLimit(input);

    if (files.length === 1) {
      const file = files[0];
      const fileInfo = await analyzeFile(file);

      const canCompress = fileInfo.supportedActions.includes("compress") || fileInfo.supportedActions.includes("clean");

      const overlay = Preflight.uploadUI.showReviewCard({
        fileName: file.name,
        fileSize: file.size,
        fileType: fileInfo.label,
        category: fileInfo.category,
        targetLimitBytes: limitBytes,
        canCompress,
        canMerge: false,
        onProcess: async (mode) => {
          return await processSingleFile(file, fileInfo, limitBytes);
        },
        onContinueOriginal: () => {
          openOverlays.delete(input);
          releaseOriginal(input);
        },
        onContinueUpload: (processedFile) => {
          openOverlays.delete(input);
          replaceInputFile(input, processedFile || file);
        },
        onCancel: () => cancelSelection(input, overlay),
        onDownload: (blob, name) => {
          if (Preflight.downloader) Preflight.downloader.downloadFile(blob, name);
        },
        onCopy: async (blob) => {
          if (Preflight.clipboard) return await Preflight.clipboard.copyImageToClipboard(blob);
          return { ok: false };
        },
        onOpenWorkspace: async () => {
          try {
            await Preflight.storageBridge.savePending(file, file.name, file.type, "upload");
            chrome.runtime.sendMessage({ type: "OPEN_OPTIMIZER" });
          } catch (e) {}
          overlay.close();
          openOverlays.delete(input);
          releaseOriginal(input);
        }
      });

      openOverlays.set(input, overlay);
      return;
    }

    // Multiple files
    const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
    const allPdfs = files.every((f) => f.type === "application/pdf" || (f.name || "").toLowerCase().endsWith(".pdf"));
    const allImages = files.every((f) => isSupportedImageFile(f));

    const overlay = Preflight.uploadUI.showReviewCard({
      fileName: `${files[0].name} (+${files.length - 1} other files)`,
      fileSize: totalBytes,
      fileType: allPdfs ? `${files.length} PDFs` : (allImages ? `${files.length} Images` : `${files.length} Files`),
      category: allPdfs ? "pdf" : (allImages ? "image" : "mixed"),
      targetLimitBytes: limitBytes,
      canCompress: allImages,
      canMerge: allPdfs,
      onProcess: async (mode) => {
        if (allPdfs && mode === "merge") {
          const proc = await ensurePdfProcessor();
          const mergedBlob = await proc.mergePdfs(files);
          const mergedName = `merged-${Date.now()}.pdf`;
          const mergedFile = new File([mergedBlob], mergedName, { type: "application/pdf" });
          return {
            name: mergedName,
            originalSize: totalBytes,
            optimizedSize: mergedBlob.size,
            reductionPercent: totalBytes > 0 ? Math.max(0, (totalBytes - mergedBlob.size) / totalBytes) : 0,
            blob: mergedBlob,
            file: mergedFile,
            alreadyOptimized: false
          };
        }

        if (allImages) {
          return await batchOptimizeImages(files, limitBytes);
        }

        throw new Error("No multi-file processing available for this selection.");
      },
      onContinueOriginal: () => {
        openOverlays.delete(input);
        releaseOriginal(input);
      },
      onContinueUpload: (processedFile) => {
        openOverlays.delete(input);
        if (processedFile && processedFile instanceof File) {
          replaceInputFile(input, processedFile);
        } else if (Array.isArray(processedFile)) {
          replaceInputFiles(input, processedFile);
        } else {
          releaseOriginal(input);
        }
      },
      onCancel: () => cancelSelection(input, overlay),
      onDownload: (blob, name) => {
        if (Preflight.downloader) Preflight.downloader.downloadFile(blob, name);
      }
    });

    openOverlays.set(input, overlay);
  }

  async function processSingleFile(file, fileInfo, limitBytes) {
    if (fileInfo.category === "image") {
      const strategy = determineStrategy(fileInfo, { contentHint: "unknown", targetBytes: limitBytes });
      const result = await optimizeImage(file, {
        format: strategy.format,
        quality: strategy.quality || 82,
        maxDimension: strategy.maxDimension,
        targetBytes: limitBytes
      });

      const outputName = buildOutputFilename(file.name, result.format);
      const outputBlob = result.blob;
      const finalFile = new File([outputBlob], outputName, { type: result.format });

      return {
        name: outputName,
        originalSize: file.size,
        optimizedSize: outputBlob.size,
        reductionPercent: result.reductionPercent,
        blob: outputBlob,
        file: finalFile,
        alreadyOptimized: result.alreadyOptimized
      };
    }

    if (fileInfo.category === "pdf") {
      const proc = await ensurePdfProcessor();
      const result = await proc.compressPdf(file);
      const outputName = buildOutputFilename(file.name, "pdf");
      const finalFile = new File([result.blob], outputName, { type: "application/pdf" });

      return {
        name: outputName,
        originalSize: result.originalSize,
        optimizedSize: result.optimizedSize,
        reductionPercent: result.reductionPercent,
        blob: result.blob,
        file: finalFile,
        alreadyOptimized: result.alreadyOptimized
      };
    }

    if ((fileInfo.category === "text" || fileInfo.category === "csv") && Preflight.textProcessor) {
      const result = await Preflight.textProcessor.cleanText(file);
      const finalFile = new File([result.blob], file.name, { type: file.type });

      return {
        name: file.name,
        originalSize: result.originalSize,
        optimizedSize: result.optimizedSize,
        reductionPercent: result.reductionPercent,
        blob: result.blob,
        file: finalFile,
        alreadyOptimized: result.alreadyOptimized
      };
    }

    // Default passthrough
    return {
      name: file.name,
      originalSize: file.size,
      optimizedSize: file.size,
      reductionPercent: 0,
      blob: file,
      file: file,
      alreadyOptimized: true
    };
  }

  async function batchOptimizeImages(files, limitBytes) {
    const optimizedFiles = [];
    let totalOptimized = 0;
    const totalOriginal = files.reduce((acc, f) => acc + f.size, 0);

    for (const f of files) {
      try {
        const info = await analyzeFile(f);
        const strat = determineStrategy(info, { contentHint: "unknown", targetBytes: limitBytes });
        const res = await optimizeImage(f, {
          format: strat.format,
          quality: strat.quality || 82,
          maxDimension: strat.maxDimension,
          targetBytes: limitBytes
        });
        const outName = buildOutputFilename(f.name, res.format);
        const optFile = new File([res.blob], outName, { type: res.format });
        optimizedFiles.push(optFile);
        totalOptimized += res.blob.size;
      } catch (e) {
        optimizedFiles.push(f);
        totalOptimized += f.size;
      }
    }

    return {
      name: `${files.length} Optimized Images`,
      originalSize: totalOriginal,
      optimizedSize: totalOptimized,
      reductionPercent: totalOriginal > 0 ? Math.max(0, (totalOriginal - totalOptimized) / totalOriginal) : 0,
      file: optimizedFiles,
      alreadyOptimized: totalOptimized >= totalOriginal
    };
  }

  function replaceInputFile(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.dataset.preflightBypass = "1";
    input.files = dt.files;
    redispatch(input);
  }

  function replaceInputFiles(input, fileArray) {
    const dt = new DataTransfer();
    fileArray.forEach((f) => dt.items.add(f));
    input.dataset.preflightBypass = "1";
    input.files = dt.files;
    redispatch(input);
  }

  function releaseOriginal(input) {
    input.dataset.preflightBypass = "1";
    redispatch(input);
  }

  function cancelSelection(input, overlay) {
    overlay.close();
    openOverlays.delete(input);
    input.value = "";
    try {
      input.dispatchEvent(new Event("cancel", { bubbles: true }));
    } catch (e) {}
  }

  async function ensurePdfProcessor() {
    if (Preflight.pdfProcessor) return Preflight.pdfProcessor;
    return new Promise((resolve, reject) => {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
        if (Preflight.pdfProcessor) return resolve(Preflight.pdfProcessor);
        return reject(new Error("PDF processor is not available in this context."));
      }
      chrome.runtime.sendMessage({ type: "ENSURE_PDF_LIB" }, (resp) => {
        if (resp && resp.ok && Preflight.pdfProcessor) {
          resolve(Preflight.pdfProcessor);
        } else {
          reject(new Error((resp && resp.error) || "Could not initialize PDF engine."));
        }
      });
    });
  }

  function redispatch(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function detectUploadLimit(input) {
    const scopes = [];
    if (input.form) scopes.push(input.form);
    let node = input;
    for (let i = 0; i < 4 && node.parentElement; i += 1) {
      node = node.parentElement;
      scopes.push(node);
    }
    if (scopes.length < 2 && input.getRootNode && input.getRootNode().host) {
      scopes.push(input.getRootNode().host);
    }

    for (const scope of scopes) {
      const text = (scope.textContent || "").slice(0, 4000);
      const match = text.match(LIMIT_PATTERN);
      if (match) {
        const value = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        if (Number.isFinite(value)) {
          return Math.round(value * (unit === "mb" ? 1024 * 1024 : 1024));
        }
      }
    }
    return null;
  }
})(typeof window !== "undefined" ? window : globalThis);
