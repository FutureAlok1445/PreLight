/**
 * upload/area-snipper.js
 * Interactive Custom-Size Area Screenshot selection tool.
 * Provides a Lightshot / Windows Snipping Tool-style screen overlay:
 *  - Dimmed backdrop with crosshair cursor
 *  - Interactive click-and-drag bounding box with live pixel dimensions
 *  - Corner handles and floating confirm/cancel toolbar
 *  - Viewport-aware cropping with high-DPI (Retina) scaling
 *  - Direct handoff into the PREflight local workspace
 */
(function (global) {
  "use strict";

  if (global.__preflightAreaSnipperInstalled) return;
  global.__preflightAreaSnipperInstalled = true;

  const Preflight = global.Preflight || (global.Preflight = {});

  const SNIPPER_STYLE = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      cursor: crosshair;
      user-select: none;
      -webkit-user-select: none;
    }
    *, *::before, *::after { box-sizing: border-box; }
    .pf-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
    }
    .pf-selection {
      position: absolute;
      border: 1px dashed #ffffff;
      box-shadow: 0 0 0 99999px rgba(0, 0, 0, 0.5), 0 0 12px rgba(0, 0, 0, 0.3);
      cursor: move;
      display: none;
    }
    .pf-dims-badge {
      position: absolute;
      top: -26px;
      left: 0;
      background: #111111;
      color: #ffffff;
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 11.5px;
      font-weight: 700;
      padding: 3px 7px;
      border-radius: 2px;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    .pf-toolbar {
      position: absolute;
      bottom: -40px;
      right: 0;
      display: flex;
      gap: 6px;
      background: #ffffff;
      padding: 4px 6px;
      border: 1px solid #111111;
      border-radius: 3px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      pointer-events: auto;
      font-family: "Times New Roman", Times, Georgia, serif;
    }
    .pf-toolbar-btn {
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid #111111;
      border-radius: 2px;
      padding: 4px 10px;
      cursor: pointer;
      background: #ffffff;
      color: #111111;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background 100ms ease;
    }
    .pf-toolbar-btn:hover {
      background: #f0f0f0;
    }
    .pf-toolbar-btn-primary {
      background: #111111;
      color: #ffffff;
    }
    .pf-toolbar-btn-primary:hover {
      background: #2e2e2e;
    }
    .pf-handle {
      position: absolute;
      width: 8px;
      height: 8px;
      background: #ffffff;
      border: 1px solid #111111;
      border-radius: 1px;
    }
    .pf-handle-tl { top: -4px; left: -4px; cursor: nwse-resize; }
    .pf-handle-tr { top: -4px; right: -4px; cursor: nesw-resize; }
    .pf-handle-bl { bottom: -4px; left: -4px; cursor: nesw-resize; }
    .pf-handle-br { bottom: -4px; right: -4px; cursor: nwse-resize; }
    .pf-instruction {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #111111;
      color: #ffffff;
      padding: 7px 16px;
      border-radius: 3px;
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 13px;
      font-style: italic;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      pointer-events: none;
      z-index: 10;
    }
  `;

  let activeSession = null;

  function startAreaSnipper() {
    if (activeSession) activeSession.teardown();

    const host = document.createElement("div");
    host.id = "preflight-snipper-host";
    const shadow = host.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = SNIPPER_STYLE;
    shadow.appendChild(styleEl);

    const backdrop = document.createElement("div");
    backdrop.className = "pf-backdrop";

    const instruction = document.createElement("div");
    instruction.className = "pf-instruction";
    instruction.textContent = "Click and drag to select an area · Press Escape to cancel";

    const selectionBox = document.createElement("div");
    selectionBox.className = "pf-selection";

    const dimsBadge = document.createElement("div");
    dimsBadge.className = "pf-dims-badge";
    dimsBadge.textContent = "0 \u00D7 0 px";

    const toolbar = document.createElement("div");
    toolbar.className = "pf-toolbar";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "pf-toolbar-btn pf-toolbar-btn-primary";
    confirmBtn.type = "button";
    confirmBtn.textContent = "\u2713 Prepare in PREflight";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pf-toolbar-btn";
    cancelBtn.type = "button";
    cancelBtn.textContent = "\u2715 Cancel";

    toolbar.append(confirmBtn, cancelBtn);

    const hTL = document.createElement("div"); hTL.className = "pf-handle pf-handle-tl";
    const hTR = document.createElement("div"); hTR.className = "pf-handle pf-handle-tr";
    const hBL = document.createElement("div"); hBL.className = "pf-handle pf-handle-bl";
    const hBR = document.createElement("div"); hBR.className = "pf-handle pf-handle-br";

    selectionBox.append(dimsBadge, toolbar, hTL, hTR, hBL, hBR);
    shadow.append(backdrop, instruction, selectionBox);
    document.documentElement.appendChild(host);

    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let rect = { x: 0, y: 0, w: 0, h: 0 };

    function onMouseDown(e) {
      if (toolbar.contains(e.target)) return;
      isDrawing = true;
      startX = e.clientX;
      startY = e.clientY;
      rect = { x: startX, y: startY, w: 0, h: 0 };
      updateBox();
      selectionBox.style.display = "block";
      toolbar.style.display = "none";
    }

    function onMouseMove(e) {
      if (!isDrawing) return;
      const currentX = e.clientX;
      const currentY = e.clientY;

      rect.x = Math.min(startX, currentX);
      rect.y = Math.min(startY, currentY);
      rect.w = Math.abs(currentX - startX);
      rect.h = Math.abs(currentY - startY);

      updateBox();
    }

    function onMouseUp(e) {
      if (!isDrawing) return;
      isDrawing = false;
      if (rect.w < 10 || rect.h < 10) {
        selectionBox.style.display = "none";
        return;
      }
      toolbar.style.display = "flex";
      // Ensure toolbar doesn't go below viewport
      if (rect.y + rect.h + 45 > window.innerHeight) {
        toolbar.style.bottom = "8px";
        toolbar.style.right = "8px";
      } else {
        toolbar.style.bottom = "-40px";
        toolbar.style.right = "0";
      }
    }

    function updateBox() {
      selectionBox.style.left = `${rect.x}px`;
      selectionBox.style.top = `${rect.y}px`;
      selectionBox.style.width = `${rect.w}px`;
      selectionBox.style.height = `${rect.h}px`;
      dimsBadge.textContent = `${rect.w} \u00D7 ${rect.h} px`;
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        teardown();
      } else if (e.key === "Enter" && rect.w >= 10 && rect.h >= 10) {
        confirmCrop();
      }
    }

    async function confirmCrop() {
      if (rect.w < 10 || rect.h < 10) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Capturing\u2026";

      // Hide overlay briefly so screenshot captures raw webpage content cleanly
      host.style.display = "none";

      try {
        const dpr = window.devicePixelRatio || 1;
        const crop = {
          x: Math.round(rect.x * dpr),
          y: Math.round(rect.y * dpr),
          w: Math.round(rect.w * dpr),
          h: Math.round(rect.h * dpr),
          dpr
        };

        const response = await chrome.runtime.sendMessage({
          type: "CAPTURE_VISIBLE_TAB",
          crop
        });

        if (response && response.ok && response.dataUrl) {
          const img = new Image();
          img.src = response.dataUrl;
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });

          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, rect.w);
          canvas.height = Math.max(1, rect.h);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, rect.w, rect.h);

          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          const filename = `snip-${timestampForFilename()}.png`;

          await Preflight.storageBridge.savePending(blob, filename, "image/png", "capture");
          chrome.runtime.sendMessage({ type: "OPEN_OPTIMIZER" });
        }
      } catch (err) {
        console.error("Area snip failed:", err);
      } finally {
        teardown();
      }
    }

    function teardown() {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      host.remove();
      activeSession = null;
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);

    confirmBtn.addEventListener("click", confirmCrop);
    cancelBtn.addEventListener("click", teardown);

    activeSession = { teardown };
  }

  function timestampForFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // Listen for trigger from popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === "START_AREA_SCREENSHOT") {
        startAreaSnipper();
        sendResponse({ ok: true });
        return false;
      }
    });
  }

  Preflight.areaSnipper = {
    start: startAreaSnipper,
    startAreaSnipper,
    startAreaSelection: startAreaSnipper
  };
})(typeof window !== "undefined" ? window : globalThis);
