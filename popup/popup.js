/**
 * popup/popup.js
 * Thin launcher. The popup itself does no image encoding -- it only
 * captures/collects an image, hands it to session storage, and opens
 * the optimizer tab, which does the real work. This keeps the popup
 * fast and avoids losing in-progress work if the popup loses focus
 * and Chrome tears it down.
 */
(function () {
  "use strict";

  const { fileToDataUrl, isSupportedImageFile, formatBytes, classifyMimeType } = window.Preflight.utils;

  const RESTRICTED_URL_PREFIXES = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "https://chrome.google.com/webstore",
    "https://chromewebstore.google.com"
  ];

  const els = {
    captureAreaBtn: document.getElementById("captureAreaBtn"),
    captureBtn: document.getElementById("captureBtn"),
    selectBtn: document.getElementById("selectBtn"),
    pasteBtn: document.getElementById("pasteBtn"),
    fileInput: document.getElementById("fileInput"),
    dropZone: document.getElementById("dropZone"),
    status: document.getElementById("popupStatus"),
    lastResultCard: document.getElementById("lastResultCard"),
    copyLastBtn: document.getElementById("copyLastBtn"),
    downloadLastBtn: document.getElementById("downloadLastBtn"),
    settingsToggle: document.getElementById("settingsToggle"),
    settingsPanel: document.getElementById("settingsPanel"),
    preferredFormat: document.getElementById("preferredFormat"),
    rememberQuality: document.getElementById("rememberQuality"),
    uploadOptimizerEnabled: document.getElementById("uploadOptimizerEnabled")
  };

  let currentLastResult = null;

  init();

  async function init() {
    // Prevent accidental browser tab navigation when dropping files outside dropzone
    window.addEventListener("dragover", (e) => e.preventDefault(), false);
    window.addEventListener("drop", (e) => e.preventDefault(), false);

    wireAreaCapture();
    wireCapture();
    wireSelect();
    wirePaste();
    wireDropZone();
    wireSettings();
    wireLastResultActions();
    await renderLastResult();
  }

  function setStatus(message, kind) {
    els.status.textContent = message || "";
    els.status.classList.remove("is-error", "is-success");
    if (kind) els.status.classList.add(kind === "error" ? "is-error" : "is-success");
  }

  // ---------- Area Snipper (Custom Size Screenshot) ----------

  function wireAreaCapture() {
    if (!els.captureAreaBtn) return;
    els.captureAreaBtn.addEventListener("click", async () => {
      els.captureAreaBtn.disabled = true;
      setStatus("Select an area on the page…");
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) throw new Error("No active tab found.");
        if (isRestrictedUrl(tab.url)) {
          throw new Error("Cannot take screenshots on internal Chrome pages.");
        }

        chrome.tabs.sendMessage(tab.id, { type: "START_AREA_SCREENSHOT" }, (resp) => {
          if (chrome.runtime.lastError) {
            setStatus("Please reload this page once to enable area screenshots.", "error");
            els.captureAreaBtn.disabled = false;
          } else {
            window.close();
          }
        });
      } catch (err) {
        setStatus(err && err.message ? err.message : "Could not start area screenshot.", "error");
        els.captureAreaBtn.disabled = false;
      }
    });
  }

  // ---------- Capture Screenshot ----------

  function wireCapture() {
    els.captureBtn.addEventListener("click", async () => {
      els.captureBtn.disabled = true;
      setStatus("Capturing…");
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) throw new Error("No active tab found.");
        if (isRestrictedUrl(tab.url)) {
          throw new Error("Chrome does not allow screenshots on this page.");
        }

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        const name = `screenshot-${timestampForFilename()}.png`;
        const res = await fetch(dataUrl);
        const blob = await res.blob();

        await window.Preflight.storageBridge.savePending(blob, name, "image/png", "capture");
        await openOptimizerTab();
        window.close();
      } catch (err) {
        setStatus(err && err.message ? err.message : "Could not capture this page.", "error");
      } finally {
        els.captureBtn.disabled = false;
      }
    });
  }

  function isRestrictedUrl(url) {
    if (!url) return true;
    return (
      RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix)) ||
      url.startsWith("view-source:") ||
      url.startsWith("devtools:")
    );
  }

  // ---------- Select Image ----------

  function wireSelect() {
    els.selectBtn.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", async () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      els.fileInput.value = "";
      if (file) await handleIncomingFile(file);
    });
  }

  // ---------- Paste ----------

  function wirePaste() {
    els.pasteBtn.addEventListener("click", () => {
      els.dropZone.focus();
      setStatus("Focused. Press Ctrl+V (or Cmd+V) to paste.");
    });

    document.addEventListener("paste", async (event) => {
      const items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      const imageItem = Array.from(items).find((item) => item.type && item.type.startsWith("image/"));
      if (!imageItem) {
        setStatus("Clipboard does not contain an image.", "error");
        return;
      }
      const file = imageItem.getAsFile();
      if (file) {
        const finalFile = file.name ? file : new File([file], `pasted-${timestampForFilename()}.png`, { type: file.type || "image/png" });
        await handleIncomingFile(finalFile);
      }
    });
  }

  // ---------- Drag and drop ----------

  function wireDropZone() {
    ["dragenter", "dragover"].forEach((evt) =>
      els.dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.dropZone.classList.add("is-active");
      })
    );
    ["dragleave", "dragend", "drop"].forEach((evt) =>
      els.dropZone.addEventListener(evt, () => els.dropZone.classList.remove("is-active"))
    );
    els.dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) await handleIncomingFile(file);
    });
    els.dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") els.fileInput.click();
    });
  }

  // ---------- Shared incoming-file handler ----------

  async function handleIncomingFile(file) {
    setStatus("Opening PREflight workspace…");
    try {
      await window.Preflight.storageBridge.savePending(file, file.name, file.type, "import");
      await openOptimizerTab();
      window.close();
    } catch (err) {
      setStatus("Could not load file.", "error");
    }
  }

  async function openOptimizerTab() {
    await chrome.tabs.create({ url: chrome.runtime.getURL("optimizer/optimizer.html") });
  }

  function timestampForFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
      d.getMinutes()
    )}${pad(d.getSeconds())}`;
  }

  // ---------- Last result quick actions ----------

  function wireLastResultActions() {
    els.copyLastBtn.addEventListener("click", async () => {
      if (!currentLastResult || !currentLastResult.blob) return;
      setStatus("Copying…");
      const result = await window.Preflight.clipboard.copyImageToClipboard(currentLastResult.blob);
      setStatus(result.message, result.ok ? "success" : "error");
    });

    els.downloadLastBtn.addEventListener("click", () => {
      if (!currentLastResult || !currentLastResult.blob) return;
      window.Preflight.downloader.downloadFile(currentLastResult.blob, currentLastResult.name);
    });
  }

  async function renderLastResult() {
    const last = await window.Preflight.storageBridge.getLastResult();
    if (!last) return;
    currentLastResult = last;

    els.lastResultCard.innerHTML = "";
    const nameEl = document.createElement("p");
    nameEl.className = "result-name";
    nameEl.textContent = last.name;

    const metaEl = document.createElement("p");
    metaEl.className = "result-meta";
    const reductionSpan = document.createElement("span");
    reductionSpan.className = "result-reduction";
    reductionSpan.textContent = last.reductionLabel;
    metaEl.append(`${formatBytes(last.size)} · `, reductionSpan);

    els.lastResultCard.append(nameEl, metaEl);
    els.copyLastBtn.disabled = false;
    els.downloadLastBtn.disabled = false;
  }

  // ---------- Settings ----------

  function wireSettings() {
    els.settingsToggle.addEventListener("click", () => {
      const isOpen = !els.settingsPanel.hidden;
      els.settingsPanel.hidden = isOpen;
      els.settingsToggle.setAttribute("aria-expanded", String(!isOpen));
    });

    loadSettings();

    document.querySelectorAll('input[name="defaultMode"]').forEach((radio) => {
      radio.addEventListener("change", saveSettingsFromForm);
    });
    els.preferredFormat.addEventListener("change", saveSettingsFromForm);
    els.rememberQuality.addEventListener("change", saveSettingsFromForm);
    els.uploadOptimizerEnabled.addEventListener("change", saveSettingsFromForm);
  }

  async function loadSettings() {
    let settings = defaultSettings();
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const store = await chrome.storage.local.get("preflight:settings");
        if (store && store["preflight:settings"]) settings = store["preflight:settings"];
      } else if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("preflight:settings");
        if (saved) settings = Object.assign({}, settings, JSON.parse(saved));
      }
    } catch (e) {}

    const modeInput = document.querySelector(`input[name="defaultMode"][value="${settings.defaultMode}"]`);
    if (modeInput) modeInput.checked = true;
    els.preferredFormat.value = settings.preferredFormat;
    els.rememberQuality.checked = !!settings.rememberQuality;
    els.uploadOptimizerEnabled.checked = !!settings.uploadOptimizerEnabled;
  }

  async function saveSettingsFromForm() {
    const modeInput = document.querySelector('input[name="defaultMode"]:checked');
    const settings = {
      defaultMode: modeInput ? modeInput.value : "smart",
      preferredFormat: els.preferredFormat.value,
      rememberQuality: els.rememberQuality.checked,
      uploadOptimizerEnabled: els.uploadOptimizerEnabled.checked
    };
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const store = await chrome.storage.local.get("preflight:settings");
        const merged = Object.assign({}, store["preflight:settings"], settings);
        await chrome.storage.local.set({ "preflight:settings": merged });
      } else if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("preflight:settings");
        const merged = Object.assign({}, saved ? JSON.parse(saved) : {}, settings);
        localStorage.setItem("preflight:settings", JSON.stringify(merged));
      }
    } catch (e) {}
  }

  function defaultSettings() {
    return {
      defaultMode: "smart",
      preferredFormat: "auto",
      rememberQuality: true,
      lastQuality: 82,
      uploadOptimizerEnabled: true
    };
  }
})();
