/**
 * background.js
 * Service worker managing extension lifecycle, tab capture,
 * area screenshot coordination, and tab opening.
 */

const DEFAULT_SETTINGS = {
  defaultMode: "smart", // 'smart' | 'manual'
  preferredFormat: "auto", // 'auto' | 'image/webp' | 'image/jpeg' | 'image/png'
  rememberQuality: true,
  lastQuality: 82,
  uploadOptimizerEnabled: true
};

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.storage.local.get("preflight:settings");
    const merged = Object.assign({}, DEFAULT_SETTINGS, existing["preflight:settings"] || {});
    await chrome.storage.local.set({ "preflight:settings": merged });
  } catch (err) {
    // Fail-safe initialization
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "OPEN_OPTIMIZER") {
    chrome.tabs.create({ url: chrome.runtime.getURL("optimizer/optimizer.html") });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "CAPTURE_VISIBLE_TAB") {
    const windowId = sender.tab ? sender.tab.windowId : null;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" })
      .then((dataUrl) => {
        sendResponse({ ok: true, dataUrl });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err && err.message ? err.message : "Capture failed" });
      });
    return true; // async response
  }

  if (message.type === "TRIGGER_AREA_SNIP") {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: "No active tab found" });
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: "START_AREA_SCREENSHOT" }, (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: "Cannot capture area on this page (system/store page)." });
          } else {
            sendResponse({ ok: true });
          }
        });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "ENSURE_PDF_LIB") {
    if (!sender.tab || !sender.tab.id) {
      sendResponse({ ok: false, error: "No sender tab context" });
      return false;
    }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
      files: ["lib/pdf-lib.min.js", "core/pdf-processor.js"]
    })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : "Failed to load PDF engine." }));
    return true;
  }

  return false;
});
