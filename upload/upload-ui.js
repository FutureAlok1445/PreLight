/**
 * upload/upload-ui.js
 * Renders the 2-step PREflight pre-upload confirmation and optimization interface
 * inside an isolated Shadow DOM.
 *
 * Flow:
 *  Step 1 (Decision):
 *    Shows file name, type, size, and detection notes.
 *    Actions: [ Compress / Optimize ], [ Continue with Original ], [ Cancel ]
 *
 *  Step 2 (Result & Next Action):
 *    Shows Original, Optimized, and % Saved.
 *    Actions: [ Continue Upload ], [ Download ], [ Copy ], [ Back ]
 *    (Never uploads automatically -- user must explicitly confirm)
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const { formatBytes, formatPercent } = Preflight.utils;

  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .pf-card {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483647;
      width: 330px;
      background: #ffffff;
      color: #111111;
      border: 1px solid #c0c0c0;
      border-radius: 3px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
      font-family: "Times New Roman", Times, "Liberation Serif", Georgia, serif;
      font-size: 13.5px;
      line-height: 1.45;
      padding: 16px 16px 14px;
      animation: pf-in 120ms ease-out;
      -webkit-font-smoothing: antialiased;
    }
    @keyframes pf-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .pf-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; }
    .pf-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #111111; margin: 0; }
    .pf-close-btn { background: none; border: none; font-family: inherit; font-size: 17px; line-height: 1; cursor: pointer; color: #777777; padding: 0 4px; border-radius: 2px; }
    .pf-close-btn:hover { color: #111111; }
    .pf-close-btn:focus-visible { outline: 2px solid #111111; outline-offset: 1px; }
    .pf-name { font-size: 14px; font-weight: 700; margin: 0 0 4px; word-break: break-all; color: #111111; }
    .pf-meta { font-size: 12px; color: #555555; font-style: italic; margin: 0 0 10px; }
    .pf-prompt-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #555555; margin: 10px 0 6px; }
    .pf-target-badge { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 2px; padding: 2px 6px; font-size: 11.5px; margin-bottom: 8px; }
    .pf-sizes-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 12px; padding: 8px 10px; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 3px; text-align: center; }
    .pf-size-col { display: flex; flex-direction: column; }
    .pf-size-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #666666; margin-bottom: 2px; }
    .pf-size-val { font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums; color: #111111; }
    .pf-saved-val { color: #14532d; }
    .pf-status-note { font-size: 12px; color: #555555; font-style: italic; margin: 0 0 10px; line-height: 1.35; }
    .pf-btn { width: 100%; font-family: inherit; font-size: 13px; font-weight: 600; border-radius: 3px; padding: 8px 12px; cursor: pointer; margin-bottom: 6px; border: 1px solid #999999; background: #ffffff; color: #111111; transition: background-color 100ms ease, border-color 100ms ease; text-align: center; }
    .pf-btn:last-child { margin-bottom: 0; }
    .pf-btn:hover { background: #f4f4f4; border-color: #555555; }
    .pf-btn:focus-visible { outline: 2px solid #111111; outline-offset: 1px; }
    .pf-btn:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: none; background: #fafafa; border-color: #dcdcdc; color: #777777; }
    .pf-btn-primary { background: #111111; border-color: #111111; color: #ffffff; }
    .pf-btn-primary:hover { background: #2d2d2d; border-color: #2d2d2d; color: #ffffff; }
    .pf-btn-ghost { background: transparent; border-color: transparent; color: #666666; font-size: 12px; padding: 5px 8px; }
    .pf-btn-ghost:hover { background: transparent; color: #111111; text-decoration: underline; }
    .pf-btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }
    .pf-btn-row .pf-btn { margin-bottom: 0; }
    .pf-error { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; border-radius: 3px; padding: 6px 8px; font-size: 12px; margin: 0 0 8px; }
    .pf-busy-wrap { display: flex; align-items: center; gap: 8px; padding: 14px 0; justify-content: center; }
    .pf-spinner { width: 16px; height: 16px; border: 2px solid #c0c0c0; border-top-color: #111111; border-radius: 50%; animation: pf-spin 600ms linear infinite; }
    @keyframes pf-spin { to { transform: rotate(360deg); } }
  `;

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        if (key === "className") node.className = props[key];
        else if (key === "textContent") node.textContent = props[key];
        else node.setAttribute(key, props[key]);
      });
    }
    (children || []).forEach((child) => node.appendChild(child));
    return node;
  }

  function createHost() {
    const host = document.createElement("div");
    host.id = "preflight-review-host";
    host.setAttribute("data-preflight-host", "true");
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);

    return { host, shadow };
  }

  function setupEscapeHandler(cleanup, onCancel) {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        cleanup();
        if (onCancel) onCancel();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return handleKeyDown;
  }

  function truncate(str, max) {
    if (!str) return "file";
    return str.length > max ? `${str.slice(0, max - 3)}...` : str;
  }

  /**
   * showReviewCard(options) -> handle
   * options: {
   *   fileName, fileSize, fileType, category, targetLimitBytes,
   *   canCompress, canMerge,
   *   onProcess(mode), onContinueOriginal(), onCancel(),
   *   onContinueUpload(processedFile), onDownload(blob, name), onCopy(blob),
   *   onOpenWorkspace()
   * }
   */
  function showReviewCard(options) {
    const { host, shadow } = createHost();

    function cleanup() {
      window.removeEventListener("keydown", handleKeyDown, true);
      host.remove();
    }

    const handleKeyDown = setupEscapeHandler(cleanup, options.onCancel);

    const card = el("div", { className: "pf-card" });
    shadow.appendChild(card);
    document.documentElement.appendChild(host);

    renderStep1();

    function renderStep1() {
      card.innerHTML = "";

      const title = el("div", { className: "pf-title", textContent: "Preflight \u00B7 Optimize before upload" });
      const closeBtn = el("button", { className: "pf-close-btn", type: "button", "aria-label": "Close", textContent: "\u00D7" });
      closeBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });
      const header = el("div", { className: "pf-header-row" }, [title, closeBtn]);

      const name = el("p", { className: "pf-name", textContent: truncate(options.fileName, 38) });
      const meta = el("p", { className: "pf-meta", textContent: `${options.fileType} \u00B7 ${formatBytes(options.fileSize)}` });

      const children = [header, name, meta];

      if (options.targetLimitBytes) {
        const targetBadge = el("div", {
          className: "pf-target-badge",
          textContent: `Site limit detected: ${formatBytes(options.targetLimitBytes)}`
        });
        children.push(targetBadge);
      }

      const promptLabel = el("div", { className: "pf-prompt-label", textContent: "What would you like to do?" });
      children.push(promptLabel);

      if (options.canCompress) {
        const compressBtn = el("button", {
          id: "actionPrimary",
          className: "pf-btn pf-btn-primary",
          type: "button",
          textContent: options.category === "pdf" ? "Compress PDF" : "Compress / Optimize"
        });
        compressBtn.addEventListener("click", () => startProcessing("compress"));
        children.push(compressBtn);
      }

      if (options.canMerge) {
        const mergeBtn = el("button", {
          className: "pf-btn pf-btn-primary",
          type: "button",
          textContent: "Merge PDFs & Prepare"
        });
        mergeBtn.addEventListener("click", () => startProcessing("merge"));
        children.push(mergeBtn);
      }

      const originalBtn = el("button", {
        className: "pf-btn",
        type: "button",
        textContent: "Continue with Original"
      });
      originalBtn.addEventListener("click", () => {
        cleanup();
        if (options.onContinueOriginal) options.onContinueOriginal();
      });
      children.push(originalBtn);

      if (options.onOpenWorkspace) {
        const workspaceBtn = el("button", {
          className: "pf-btn pf-btn-ghost",
          type: "button",
          textContent: "Open in Full Workspace\u2026"
        });
        workspaceBtn.addEventListener("click", () => {
          if (options.onOpenWorkspace) options.onOpenWorkspace();
        });
        children.push(workspaceBtn);
      }

      const cancelBtn = el("button", {
        className: "pf-btn pf-btn-ghost",
        type: "button",
        textContent: "Cancel"
      });
      cancelBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });
      children.push(cancelBtn);

      children.forEach((c) => card.appendChild(c));
    }

    async function startProcessing(mode) {
      card.innerHTML = "";

      const title = el("div", { className: "pf-title", textContent: "Preflight \u00B7 Processing locally" });
      const header = el("div", { className: "pf-header-row" }, [title]);

      const name = el("p", { className: "pf-name", textContent: truncate(options.fileName, 38) });
      const busyWrap = el("div", { className: "pf-busy-wrap" }, [
        el("div", { className: "pf-spinner" }),
        el("span", { textContent: "Optimizing in local memory\u2026" })
      ]);

      card.append(header, name, busyWrap);

      try {
        const result = await options.onProcess(mode);
        renderStep2(result);
      } catch (err) {
        renderStep2Error(err && err.message ? err.message : "Processing failed.");
      }
    }

    function renderStep2(result) {
      card.innerHTML = "";
      card.id = "resultCard";

      const title = el("div", { className: "pf-title", textContent: "Preflight \u00B7 Ready to upload" });
      const closeBtn = el("button", { className: "pf-close-btn", type: "button", "aria-label": "Close", textContent: "\u00D7" });
      closeBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });
      const header = el("div", { className: "pf-header-row" }, [title, closeBtn]);

      const name = el("p", { className: "pf-name", textContent: truncate(result.name || options.fileName, 38) });

      // 3-column stats grid
      const colOrig = el("div", { className: "pf-size-col" }, [
        el("span", { className: "pf-size-label", textContent: "Original" }),
        el("span", { className: "pf-size-val", textContent: formatBytes(result.originalSize) })
      ]);
      const colOpt = el("div", { className: "pf-size-col" }, [
        el("span", { className: "pf-size-label", textContent: "Optimized" }),
        el("span", { className: "pf-size-val", textContent: formatBytes(result.optimizedSize) })
      ]);
      const colSaved = el("div", { className: "pf-size-col" }, [
        el("span", { className: "pf-size-label", textContent: "Saved" }),
        el("span", { className: "pf-size-val pf-saved-val", textContent: formatPercent(result.reductionPercent) })
      ]);
      const grid = el("div", { className: "pf-sizes-grid" }, [colOrig, colOpt, colSaved]);

      const note = el("p", {
        className: "pf-status-note",
        textContent: result.alreadyOptimized
          ? "File was already optimally sized. Original quality preserved."
          : "Processing complete. Confirm to continue upload."
      });

      // Actions: Explicit choice
      const continueUploadBtn = el("button", {
        className: "pf-btn pf-btn-primary",
        type: "button",
        textContent: "Continue Upload"
      });
      continueUploadBtn.addEventListener("click", () => {
        cleanup();
        if (options.onContinueUpload) options.onContinueUpload(result.file);
      });

      const btnRow = el("div", { className: "pf-btn-row" });

      const downloadBtn = el("button", {
        className: "pf-btn",
        type: "button",
        textContent: "Download"
      });
      downloadBtn.addEventListener("click", () => {
        if (options.onDownload) options.onDownload(result.blob, result.name || options.fileName);
      });
      btnRow.appendChild(downloadBtn);

      if (options.category === "image" && options.onCopy) {
        const copyBtn = el("button", {
          className: "pf-btn",
          type: "button",
          textContent: "Copy"
        });
        copyBtn.addEventListener("click", async () => {
          copyBtn.textContent = "Copying\u2026";
          const res = await options.onCopy(result.blob);
          copyBtn.textContent = res && res.ok ? "\u2713 Copied" : "Copy Failed";
        });
        btnRow.appendChild(copyBtn);
      }

      const backBtn = el("button", {
        className: "pf-btn pf-btn-ghost",
        type: "button",
        textContent: "\u2190 Back"
      });
      backBtn.addEventListener("click", renderStep1);

      card.append(header, name, grid, note, continueUploadBtn, btnRow, backBtn);
    }

    function renderStep2Error(msg) {
      card.innerHTML = "";

      const title = el("div", { className: "pf-title", textContent: "Preflight \u00B7 Notice" });
      const closeBtn = el("button", { className: "pf-close-btn", type: "button", textContent: "\u00D7" });
      closeBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });
      const header = el("div", { className: "pf-header-row" }, [title, closeBtn]);

      const errorEl = el("div", { className: "pf-error", textContent: msg });

      const continueOriginalBtn = el("button", {
        className: "pf-btn pf-btn-primary",
        type: "button",
        textContent: "Continue with Original File"
      });
      continueOriginalBtn.addEventListener("click", () => {
        cleanup();
        if (options.onContinueOriginal) options.onContinueOriginal();
      });

      const cancelBtn = el("button", { className: "pf-btn pf-btn-ghost", type: "button", textContent: "Cancel" });
      cancelBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });

      card.append(header, errorEl, continueOriginalBtn, cancelBtn);
    }

    return {
      close() {
        cleanup();
      }
    };
  }

  Preflight.uploadUI = { showReviewCard };
})(typeof window !== "undefined" ? window : globalThis);
