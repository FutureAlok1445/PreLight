/**
 * optimizer/optimizer.js
 * Comprehensive Preflight File Preparation Workspace.
 * Handles Images, PDFs (compress, split, merge), Text & CSV (clean, convert to PDF, export JSON),
 * and Document metadata verification.
 * Runs 100% locally in-memory with zero network transmission.
 */
(function () {
  "use strict";

  const P = window.Preflight || {};
  const { formatBytes, formatPercent, buildOutputFilename, isSupportedImageFile } = P.utils || {};
  const { analyzeFile } = P.fileAnalyzer || {};
  const { analyzeImage } = P.fileAnalyzer || {};
  const { determineStrategy } = P.smartProfile || {};
  const { optimizeImage, sampleContentHint } = P.imageOptimizer || {};
  const { copyImageToClipboard } = P.clipboard || {};
  const { downloadFile } = P.downloader || {};
  const pdfProcessor = P.pdfProcessor;
  const textProcessor = P.textProcessor;

  const SETTINGS_KEY = "preflight:settings";

  const state = {
    originalFile: null,
    fileInfo: null,
    category: "image", // 'image' | 'pdf' | 'text' | 'csv' | 'document' | 'other'

    // Image-specific
    imageMeta: null,
    contentHint: "unknown",
    selectedFormat: "auto",
    selectedQuality: 82,
    selectedResize: 0,
    imageResult: null,
    originalUrl: null,
    optimizedUrl: null,
    activePreviewTab: "after",
    processing: false,

    // PDF-specific
    pdfActiveSubView: "compress", // 'compress' | 'split' | 'merge'
    pdfPageCount: 1,
    pdfCompressedResult: null,
    pdfSplitResult: null,
    pdfMergeQueue: [],
    pdfMergedResult: null,

    // Text-specific
    textAnalysis: null,
    textCleanedResult: null
  };

  let currentOptimizationId = 0;
  let pendingReoptimize = false;

  const els = collectEls();

  init();

  async function init() {
    // Prevent accidental browser navigation on drop outside dropzone
    window.addEventListener("dragover", (e) => e.preventDefault(), false);
    window.addEventListener("drop", (e) => e.preventDefault(), false);

    wireEmptyState();
    wireHeaderActions();
    wireImageControls();
    wireImageActions();
    wirePdfControls();
    wireTextControls();
    wireDocumentControls();

    const settings = await loadSettings();
    if (settings.preferredFormat && settings.preferredFormat !== "auto") {
      state.selectedFormat = settings.preferredFormat;
    }
    if (settings.rememberQuality && settings.lastQuality) {
      state.selectedQuality = settings.lastQuality;
      if (els.qualitySlider) els.qualitySlider.value = String(settings.lastQuality);
      if (els.qualityValue) els.qualityValue.textContent = String(settings.lastQuality);
    }
    syncFormatButtons();

    // Check if a file was passed via storage bridge (e.g. from popup or upload interceptor)
    const pending = await consumePending();
    if (pending) {
      await loadFile(pending);
    }
  }

  function collectEls() {
    return {
      emptyState: document.getElementById("emptyState"),
      workState: document.getElementById("workState"),
      emptySelectBtn: document.getElementById("emptySelectBtn"),
      emptyPasteBtn: document.getElementById("emptyPasteBtn"),
      emptyFileInput: document.getElementById("emptyFileInput"),
      emptyDropZone: document.getElementById("emptyDropZone"),

      fileName: document.getElementById("fileName"),
      fileMetaBadge: document.getElementById("fileMetaBadge"),
      newFileBtn: document.getElementById("newFileBtn"),

      workError: document.getElementById("workError"),
      processingNotice: document.getElementById("processingNotice"),
      actionStatus: document.getElementById("actionStatus"),

      // Panels
      imagePanel: document.getElementById("imagePanel"),
      pdfPanel: document.getElementById("pdfPanel"),
      textPanel: document.getElementById("textPanel"),
      docPanel: document.getElementById("docPanel"),

      // Image Workspace
      originalSize: document.getElementById("originalSize"),
      originalDims: document.getElementById("originalDims"),
      optimizedSize: document.getElementById("optimizedSize"),
      optimizedDims: document.getElementById("optimizedDims"),
      reductionValue: document.getElementById("reductionValue"),
      noopNotice: document.getElementById("noopNotice"),
      tabBefore: document.getElementById("tabBefore"),
      tabAfter: document.getElementById("tabAfter"),
      previewImage: document.getElementById("previewImage"),
      qualitySlider: document.getElementById("qualitySlider"),
      qualityValue: document.getElementById("qualityValue"),
      formatButtons: Array.from(document.querySelectorAll(".segmented-btn")),
      resizeSelect: document.getElementById("resizeSelect"),
      reoptimizeBtn: document.getElementById("reoptimizeBtn"),
      copyBtn: document.getElementById("copyBtn"),
      downloadBtn: document.getElementById("downloadBtn"),
      downloadOriginalBtn: document.getElementById("downloadOriginalBtn"),

      // PDF Workspace
      pdfTabCompress: document.getElementById("pdfTabCompress"),
      pdfTabSplit: document.getElementById("pdfTabSplit"),
      pdfTabMerge: document.getElementById("pdfTabMerge"),
      pdfCompressView: document.getElementById("pdfCompressView"),
      pdfSplitView: document.getElementById("pdfSplitView"),
      pdfMergeView: document.getElementById("pdfMergeView"),

      pdfOrigSize: document.getElementById("pdfOrigSize"),
      pdfOptSize: document.getElementById("pdfOptSize"),
      pdfReductionVal: document.getElementById("pdfReductionVal"),
      runPdfCompressBtn: document.getElementById("runPdfCompressBtn"),
      downloadPdfCompressedBtn: document.getElementById("downloadPdfCompressedBtn"),

      pdfSplitRangeInput: document.getElementById("pdfSplitRangeInput"),
      pdfSplitRangeHint: document.getElementById("pdfSplitRangeHint"),
      runPdfSplitBtn: document.getElementById("runPdfSplitBtn"),
      downloadPdfSplitBtn: document.getElementById("downloadPdfSplitBtn"),

      pdfQueueList: document.getElementById("pdfQueueList"),
      addPdfToQueueBtn: document.getElementById("addPdfToQueueBtn"),
      pdfQueueInput: document.getElementById("pdfQueueInput"),
      runPdfMergeBtn: document.getElementById("runPdfMergeBtn"),
      downloadPdfMergedBtn: document.getElementById("downloadPdfMergedBtn"),

      // Text / CSV Workspace
      textLinesVal: document.getElementById("textLinesVal"),
      textWordsVal: document.getElementById("textWordsVal"),
      textCharsVal: document.getElementById("textCharsVal"),
      csvDelimItem: document.getElementById("csvDelimItem"),
      csvDelimVal: document.getElementById("csvDelimVal"),
      cleanTextBtn: document.getElementById("cleanTextBtn"),
      textToPdfBtn: document.getElementById("textToPdfBtn"),
      csvToJsonBtn: document.getElementById("csvToJsonBtn"),
      downloadTextBtn: document.getElementById("downloadTextBtn"),

      // Doc / Other Workspace
      docNotice: document.getElementById("docNotice"),
      downloadDocBtn: document.getElementById("downloadDocBtn")
    };
  }

  // ---------- Storage & Settings ----------

  async function consumePending() {
    if (P.storageBridge && P.storageBridge.getPending) {
      return await P.storageBridge.getPending();
    }
    return null;
  }

  async function loadSettings() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const store = await chrome.storage.local.get(SETTINGS_KEY);
        if (store && store[SETTINGS_KEY]) return store[SETTINGS_KEY];
      } else if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) return JSON.parse(saved);
      }
    } catch (e) {}
    return {
      defaultMode: "smart",
      preferredFormat: "auto",
      rememberQuality: true,
      lastQuality: 82,
      uploadOptimizerEnabled: true
    };
  }

  async function persistLastQuality(quality) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const store = await chrome.storage.local.get(SETTINGS_KEY);
        const settings = store[SETTINGS_KEY] || {};
        if (settings.rememberQuality === false) return;
        settings.lastQuality = quality;
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      } else if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(SETTINGS_KEY);
        const settings = saved ? JSON.parse(saved) : {};
        if (settings.rememberQuality === false) return;
        settings.lastQuality = quality;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      }
    } catch (e) {}
  }

  // ---------- Empty State Handling ----------

  function wireEmptyState() {
    els.emptySelectBtn.addEventListener("click", () => els.emptyFileInput.click());
    els.emptyFileInput.addEventListener("change", async () => {
      const file = els.emptyFileInput.files && els.emptyFileInput.files[0];
      els.emptyFileInput.value = "";
      if (file) await loadFile(file);
    });

    els.emptyPasteBtn.addEventListener("click", () => els.emptyDropZone.focus());

    document.addEventListener("paste", async (event) => {
      const items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            const finalFile = file.name ? file : new File([file], `clipboard-${Date.now()}.${file.type.split("/")[1] || "png"}`, { type: file.type });
            await loadFile(finalFile);
            return;
          }
        }
      }
    });

    ["dragenter", "dragover"].forEach((evt) => {
      els.emptyDropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.emptyDropZone.classList.add("is-active");
      });
    });

    ["dragleave", "dragend", "drop"].forEach((evt) => {
      els.emptyDropZone.addEventListener(evt, () => els.emptyDropZone.classList.remove("is-active"));
    });

    els.emptyDropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) await loadFile(file);
    });

    els.emptyDropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") els.emptyFileInput.click();
    });
  }

  function wireHeaderActions() {
    els.newFileBtn.addEventListener("click", resetToEmptyState);
  }

  function resetToEmptyState() {
    revokeUrls();
    state.originalFile = null;
    state.fileInfo = null;
    state.imageMeta = null;
    state.imageResult = null;
    state.pdfCompressedResult = null;
    state.pdfSplitResult = null;
    state.pdfMergeQueue = [];
    state.pdfMergedResult = null;
    state.textAnalysis = null;
    state.textCleanedResult = null;

    hideAllPanels();
    els.workState.hidden = true;
    els.emptyState.hidden = false;
    clearError();
    clearActionStatus();
  }

  function hideAllPanels() {
    els.imagePanel.hidden = true;
    els.pdfPanel.hidden = true;
    els.textPanel.hidden = true;
    els.docPanel.hidden = true;
  }

  // ---------- Unified File Loading ----------

  async function loadFile(file) {
    clearError();
    clearActionStatus();

    try {
      setProcessing(true, "Analyzing file…");
      const info = await analyzeFile(file);
      state.originalFile = file;
      state.fileInfo = info;
      state.category = info.category;

      els.fileName.textContent = file.name;
      els.fileMetaBadge.textContent = `${info.label} · ${formatBytes(file.size)}`;

      els.emptyState.hidden = true;
      els.workState.hidden = false;
      hideAllPanels();

      if (info.category === "image") {
        await activateImageWorkspace(file, info);
      } else if (info.category === "pdf") {
        await activatePdfWorkspace(file, info);
      } else if (info.category === "text" || info.category === "csv") {
        await activateTextWorkspace(file, info);
      } else {
        await activateDocumentWorkspace(file, info);
      }
    } catch (err) {
      showError(err && err.message ? err.message : "Could not load file.");
    } finally {
      setProcessing(false);
    }
  }

  // ========================================================
  // PANEL 1: IMAGE WORKSPACE
  // ========================================================

  async function activateImageWorkspace(file, info) {
    els.imagePanel.hidden = false;
    const meta = await analyzeImage(file);
    state.imageMeta = meta;

    revokeUrls();
    state.originalUrl = URL.createObjectURL(file);

    els.originalSize.textContent = formatBytes(meta.size);
    els.originalDims.textContent = `${meta.width} × ${meta.height}`;

    state.contentHint = await sampleHint(file);

    const strategy = determineStrategy(meta, { contentHint: state.contentHint });
    state.selectedQuality = strategy.quality || state.selectedQuality;
    els.qualitySlider.value = String(state.selectedQuality);
    els.qualityValue.textContent = String(state.selectedQuality);

    if (strategy.maxDimension) {
      state.selectedResize = strategy.maxDimension;
      els.resizeSelect.value = String(strategy.maxDimension);
    } else {
      state.selectedResize = 0;
      els.resizeSelect.value = "0";
    }

    await runImageOptimization();
  }

  async function sampleHint(file) {
    try {
      const bitmap = await createImageBitmap(file);
      const hint = await sampleContentHint(bitmap);
      bitmap.close();
      return hint;
    } catch (err) {
      return "unknown";
    }
  }

  function wireImageControls() {
    els.qualitySlider.addEventListener("input", () => {
      els.qualityValue.textContent = els.qualitySlider.value;
    });
    els.qualitySlider.addEventListener("change", () => {
      state.selectedQuality = Number(els.qualitySlider.value);
      persistLastQuality(state.selectedQuality);
      runImageOptimization();
    });

    els.formatButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedFormat = btn.dataset.format;
        syncFormatButtons();
        runImageOptimization();
      });
    });

    els.resizeSelect.addEventListener("change", () => {
      state.selectedResize = Number(els.resizeSelect.value) || 0;
      runImageOptimization();
    });

    els.reoptimizeBtn.addEventListener("click", () => runImageOptimization());

    els.tabBefore.addEventListener("click", () => setActivePreviewTab("before"));
    els.tabAfter.addEventListener("click", () => setActivePreviewTab("after"));
  }

  function syncFormatButtons() {
    els.formatButtons.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.format === state.selectedFormat);
    });
    if (els.qualitySlider) {
      els.qualitySlider.disabled = state.selectedFormat === "image/png";
    }
  }

  function setActivePreviewTab(tab) {
    state.activePreviewTab = tab;
    els.tabBefore.classList.toggle("is-active", tab === "before");
    els.tabAfter.classList.toggle("is-active", tab === "after");
    els.tabBefore.setAttribute("aria-selected", String(tab === "before"));
    els.tabAfter.setAttribute("aria-selected", String(tab === "after"));
    updatePreviewImage();
  }

  function updatePreviewImage() {
    if (state.activePreviewTab === "before" && state.originalUrl) {
      els.previewImage.src = state.originalUrl;
    } else if (state.optimizedUrl) {
      els.previewImage.src = state.optimizedUrl;
    } else if (state.originalUrl) {
      els.previewImage.src = state.originalUrl;
    }
  }

  function resolveTargetFormat() {
    if (state.selectedFormat !== "auto") return state.selectedFormat;
    const strategy = determineStrategy(state.imageMeta, { contentHint: state.contentHint });
    return strategy.format;
  }

  async function runImageOptimization() {
    if (!state.originalFile || state.category !== "image") return;
    if (state.processing) {
      pendingReoptimize = true;
      return;
    }

    state.processing = true;
    pendingReoptimize = false;
    setProcessing(true, "Optimizing image…");
    clearError();

    const thisId = ++currentOptimizationId;

    try {
      const format = resolveTargetFormat();
      const maxDimension = state.selectedResize || null;

      const result = await optimizeImage(state.originalFile, {
        format,
        quality: state.selectedQuality,
        maxDimension
      });

      if (thisId !== currentOptimizationId) return;

      state.imageResult = result;
      renderImageResult(result);
      if (P.storageBridge && P.storageBridge.saveLastResult) {
        await P.storageBridge.saveLastResult(result, state.originalFile);
      }
    } catch (err) {
      if (thisId === currentOptimizationId) {
        showError(err && err.message ? err.message : "Optimization failed. Your original file is unchanged.");
      }
    } finally {
      if (thisId === currentOptimizationId) {
        state.processing = false;
        setProcessing(false);
        if (pendingReoptimize) {
          pendingReoptimize = false;
          runImageOptimization();
        }
      }
    }
  }

  function renderImageResult(result) {
    if (state.optimizedUrl) URL.revokeObjectURL(state.optimizedUrl);
    state.optimizedUrl = URL.createObjectURL(result.blob);

    els.optimizedSize.textContent = formatBytes(result.optimizedSize);
    els.optimizedDims.textContent = `${result.width} × ${result.height}`;
    els.reductionValue.textContent = result.alreadyOptimized ? "0%" : formatPercent(result.reductionPercent);
    els.noopNotice.hidden = !result.alreadyOptimized;

    updatePreviewImage();
  }

  function wireImageActions() {
    els.copyBtn.addEventListener("click", async () => {
      if (!state.imageResult) return;
      setActionStatus("Copying image to clipboard…");
      const result = await copyImageToClipboard(state.imageResult.blob);
      setActionStatus(result.message, result.ok ? "success" : "error");
    });

    els.downloadBtn.addEventListener("click", () => {
      if (!state.imageResult) return;
      const name = state.imageResult.alreadyOptimized
        ? state.originalFile.name
        : buildOutputFilename(state.originalFile.name, state.imageResult.format);
      downloadFile(state.imageResult.blob, name);
      setActionStatus(`Downloaded ${name}`, "success");
    });

    els.downloadOriginalBtn.addEventListener("click", () => {
      if (!state.originalFile) return;
      downloadFile(state.originalFile, state.originalFile.name);
      setActionStatus(`Downloaded ${state.originalFile.name}`, "success");
    });
  }

  // ========================================================
  // PANEL 2: PDF WORKSPACE
  // ========================================================

  async function activatePdfWorkspace(file, info) {
    els.pdfPanel.hidden = false;
    setPdfSubView("compress");

    // Initialize compress view stats
    els.pdfOrigSize.textContent = formatBytes(file.size);
    els.pdfOptSize.textContent = "—";
    els.pdfReductionVal.textContent = "—";
    els.downloadPdfCompressedBtn.disabled = true;

    // Analyze page count
    if (pdfProcessor) {
      try {
        const analysis = await pdfProcessor.analyzePdf(file);
        state.pdfPageCount = analysis.pageCount || 1;
        els.pdfSplitRangeHint.textContent = `Document has ${state.pdfPageCount} page${state.pdfPageCount > 1 ? "s" : ""}.`;
      } catch (e) {
        state.pdfPageCount = 1;
        els.pdfSplitRangeHint.textContent = "Page count unavailable.";
      }
    }

    // Reset merge queue with current file as first item
    state.pdfMergeQueue = [file];
    renderPdfQueue();
  }

  function wirePdfControls() {
    els.pdfTabCompress.addEventListener("click", () => setPdfSubView("compress"));
    els.pdfTabSplit.addEventListener("click", () => setPdfSubView("split"));
    els.pdfTabMerge.addEventListener("click", () => setPdfSubView("merge"));

    // Subview 1: Compress
    els.runPdfCompressBtn.addEventListener("click", async () => {
      if (!pdfProcessor || !state.originalFile) return;
      try {
        setProcessing(true, "Compressing PDF object streams…");
        clearError();
        const result = await pdfProcessor.compressPdf(state.originalFile);
        state.pdfCompressedResult = result;

        els.pdfOptSize.textContent = formatBytes(result.optimizedSize);
        els.pdfReductionVal.textContent = result.alreadyOptimized ? "0%" : formatPercent(result.reductionPercent);
        els.downloadPdfCompressedBtn.disabled = false;
        setActionStatus(
          result.alreadyOptimized
            ? "PDF is already optimally compressed. Preserved original."
            : `PDF compressed! Saved ${formatPercent(result.reductionPercent)}.`,
          "success"
        );
      } catch (err) {
        showError("PDF compression failed: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.downloadPdfCompressedBtn.addEventListener("click", () => {
      if (!state.pdfCompressedResult) return;
      const name = buildOutputFilename(state.originalFile.name, "pdf");
      downloadFile(state.pdfCompressedResult.blob, name);
      setActionStatus(`Downloaded ${name}`, "success");
    });

    // Subview 2: Split
    els.runPdfSplitBtn.addEventListener("click", async () => {
      if (!pdfProcessor || !state.originalFile) return;
      const range = els.pdfSplitRangeInput.value.trim();
      if (!range) {
        showError("Please specify page numbers or ranges to extract (e.g. 1-2, 4).");
        return;
      }
      try {
        setProcessing(true, "Extracting pages…");
        clearError();
        const splitBlob = await pdfProcessor.splitPdf(state.originalFile, range);
        state.pdfSplitResult = splitBlob;
        els.downloadPdfSplitBtn.disabled = false;
        setActionStatus(`Extracted pages into a new PDF (${formatBytes(splitBlob.size)}).`, "success");
      } catch (err) {
        showError("Failed to extract pages: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.downloadPdfSplitBtn.addEventListener("click", () => {
      if (!state.pdfSplitResult) return;
      const base = state.originalFile.name.replace(/\.pdf$/i, "");
      const name = `${base}-extracted.pdf`;
      downloadFile(state.pdfSplitResult, name);
      setActionStatus(`Downloaded ${name}`, "success");
    });

    // Subview 3: Merge
    els.addPdfToQueueBtn.addEventListener("click", () => els.pdfQueueInput.click());
    els.pdfQueueInput.addEventListener("change", () => {
      const files = Array.from(els.pdfQueueInput.files || []);
      els.pdfQueueInput.value = "";
      if (files.length > 0) {
        state.pdfMergeQueue.push(...files);
        renderPdfQueue();
      }
    });

    els.runPdfMergeBtn.addEventListener("click", async () => {
      if (!pdfProcessor || state.pdfMergeQueue.length < 2) return;
      try {
        setProcessing(true, `Merging ${state.pdfMergeQueue.length} PDFs…`);
        clearError();
        const mergedBlob = await pdfProcessor.mergePdfs(state.pdfMergeQueue);
        state.pdfMergedResult = mergedBlob;
        els.downloadPdfMergedBtn.disabled = false;
        setActionStatus(`Successfully merged ${state.pdfMergeQueue.length} PDFs (${formatBytes(mergedBlob.size)})!`, "success");
      } catch (err) {
        showError("Merge failed: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.downloadPdfMergedBtn.addEventListener("click", () => {
      if (!state.pdfMergedResult) return;
      const name = `merged-${Date.now()}.pdf`;
      downloadFile(state.pdfMergedResult, name);
      setActionStatus(`Downloaded ${name}`, "success");
    });
  }

  function setPdfSubView(view) {
    state.pdfActiveSubView = view;
    els.pdfTabCompress.classList.toggle("is-active", view === "compress");
    els.pdfTabSplit.classList.toggle("is-active", view === "split");
    els.pdfTabMerge.classList.toggle("is-active", view === "merge");

    els.pdfCompressView.hidden = view !== "compress";
    els.pdfSplitView.hidden = view !== "split";
    els.pdfMergeView.hidden = view !== "merge";
  }

  function renderPdfQueue() {
    els.pdfQueueList.innerHTML = "";
    state.pdfMergeQueue.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "pdf-queue-item";

      const title = document.createElement("span");
      title.className = "pdf-queue-title";
      title.textContent = `${index + 1}. ${file.name} (${formatBytes(file.size)})`;

      const controls = document.createElement("div");
      controls.className = "pdf-queue-controls";

      if (index > 0) {
        const upBtn = document.createElement("button");
        upBtn.className = "btn btn-secondary btn-small";
        upBtn.type = "button";
        upBtn.textContent = "↑";
        upBtn.title = "Move Up";
        upBtn.addEventListener("click", () => {
          const temp = state.pdfMergeQueue[index - 1];
          state.pdfMergeQueue[index - 1] = state.pdfMergeQueue[index];
          state.pdfMergeQueue[index] = temp;
          renderPdfQueue();
        });
        controls.appendChild(upBtn);
      }

      if (index < state.pdfMergeQueue.length - 1) {
        const downBtn = document.createElement("button");
        downBtn.className = "btn btn-secondary btn-small";
        downBtn.type = "button";
        downBtn.textContent = "↓";
        downBtn.title = "Move Down";
        downBtn.addEventListener("click", () => {
          const temp = state.pdfMergeQueue[index + 1];
          state.pdfMergeQueue[index + 1] = state.pdfMergeQueue[index];
          state.pdfMergeQueue[index] = temp;
          renderPdfQueue();
        });
        controls.appendChild(downBtn);
      }

      if (state.pdfMergeQueue.length > 1) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-secondary btn-small";
        removeBtn.type = "button";
        removeBtn.textContent = "✕";
        removeBtn.title = "Remove";
        removeBtn.addEventListener("click", () => {
          state.pdfMergeQueue.splice(index, 1);
          renderPdfQueue();
        });
        controls.appendChild(removeBtn);
      }

      item.appendChild(title);
      item.appendChild(controls);
      els.pdfQueueList.appendChild(item);
    });

    els.runPdfMergeBtn.disabled = state.pdfMergeQueue.length < 2;
  }

  // ========================================================
  // PANEL 3: TEXT & CSV WORKSPACE
  // ========================================================

  async function activateTextWorkspace(file, info) {
    els.textPanel.hidden = false;
    const isCsv = info.category === "csv";

    els.csvDelimItem.hidden = !isCsv;
    els.csvToJsonBtn.hidden = !isCsv;

    if (textProcessor) {
      try {
        const stats = await textProcessor.analyzeText(file);
        state.textAnalysis = stats;
        els.textLinesVal.textContent = stats.lines.toLocaleString();
        els.textWordsVal.textContent = stats.words.toLocaleString();
        els.textCharsVal.textContent = stats.characters.toLocaleString();
        if (isCsv && stats.delimiter) {
          const delimDisplay = stats.delimiter === "\t" ? "Tab" : `"${stats.delimiter}"`;
          els.csvDelimVal.textContent = delimDisplay;
        }
      } catch (e) {
        els.textLinesVal.textContent = "—";
        els.textWordsVal.textContent = "—";
        els.textCharsVal.textContent = "—";
      }
    }
  }

  function wireTextControls() {
    els.cleanTextBtn.addEventListener("click", async () => {
      if (!textProcessor || !state.originalFile) return;
      try {
        setProcessing(true, "Cleaning whitespace and empty lines…");
        clearError();
        const res = await textProcessor.cleanText(state.originalFile);
        state.textCleanedResult = res;

        if (res.alreadyOptimized) {
          setActionStatus("File has no excess trailing whitespace or empty lines. Original is intact.", "success");
        } else {
          setActionStatus(`Cleaned file! Saved ${formatBytes(res.originalSize - res.optimizedSize)} (${formatPercent(res.reductionPercent)}).`, "success");
          downloadFile(res.blob, state.originalFile.name);
        }
      } catch (err) {
        showError("Clean failed: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.textToPdfBtn.addEventListener("click", async () => {
      if (!textProcessor || !pdfProcessor || !state.originalFile) return;
      try {
        setProcessing(true, "Generating formatted PDF…");
        clearError();
        const textContent = await textProcessor.readText(state.originalFile);
        const pdfBlob = await pdfProcessor.textToPdf(textContent, { title: state.originalFile.name });
        const outName = state.originalFile.name.replace(/\.[^.]+$/, "") + ".pdf";
        downloadFile(pdfBlob, outName);
        setActionStatus(`Converted to PDF: ${outName}`, "success");
      } catch (err) {
        showError("PDF conversion failed: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.csvToJsonBtn.addEventListener("click", async () => {
      if (!textProcessor || !state.originalFile) return;
      try {
        setProcessing(true, "Exporting CSV to JSON…");
        clearError();
        const jsonBlob = await textProcessor.csvToJson(state.originalFile);
        const outName = state.originalFile.name.replace(/\.csv$/i, "") + ".json";
        downloadFile(jsonBlob, outName);
        setActionStatus(`Exported to ${outName}`, "success");
      } catch (err) {
        showError("CSV conversion failed: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.downloadTextBtn.addEventListener("click", () => {
      if (!state.originalFile) return;
      downloadFile(state.originalFile, state.originalFile.name);
      setActionStatus(`Downloaded ${state.originalFile.name}`, "success");
    });
  }

  // ========================================================
  // PANEL 4: DOCUMENT & OTHER WORKSPACE
  // ========================================================

  async function activateDocumentWorkspace(file, info) {
    els.docPanel.hidden = false;
    els.docNotice.textContent = `"${file.name}" is recognized as a ${info.label} archive (${formatBytes(file.size)}). Document packages maintain internal XML schemas and zip compression. PREflight validates its integrity and preserves your file intact for upload.`;
  }

  function wireDocumentControls() {
    els.downloadDocBtn.addEventListener("click", () => {
      if (!state.originalFile) return;
      downloadFile(state.originalFile, state.originalFile.name);
      setActionStatus(`Downloaded ${state.originalFile.name}`, "success");
    });
  }

  // ========================================================
  // SHARED UI HELPERS
  // ========================================================

  function setProcessing(isProcessing, message) {
    els.processingNotice.hidden = !isProcessing;
    if (message) els.processingNotice.textContent = message;

    const btns = [
      els.reoptimizeBtn,
      els.copyBtn,
      els.downloadBtn,
      els.runPdfCompressBtn,
      els.runPdfSplitBtn,
      els.runPdfMergeBtn,
      els.cleanTextBtn,
      els.textToPdfBtn,
      els.csvToJsonBtn
    ];
    btns.forEach((el) => {
      if (el) el.disabled = isProcessing;
    });
  }

  function showError(message) {
    els.workError.textContent = message;
    els.workError.hidden = false;
  }

  function clearError() {
    els.workError.hidden = true;
    els.workError.textContent = "";
  }

  function setActionStatus(message, kind) {
    els.actionStatus.textContent = message || "";
    els.actionStatus.classList.remove("is-error", "is-success");
    if (kind) els.actionStatus.classList.add(kind === "error" ? "is-error" : "is-success");
  }

  function clearActionStatus() {
    els.actionStatus.textContent = "";
    els.actionStatus.classList.remove("is-error", "is-success");
  }

  function revokeUrls() {
    if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
    if (state.optimizedUrl) URL.revokeObjectURL(state.optimizedUrl);
    state.originalUrl = null;
    state.optimizedUrl = null;
    if (els.previewImage) els.previewImage.removeAttribute("src");
  }

  window.addEventListener("beforeunload", revokeUrls);
})();
