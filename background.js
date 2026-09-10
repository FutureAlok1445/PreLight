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

  if (message.type === "START_DESKTOP_CAPTURE") {
    (async () => {
      try {
        let [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
          const allTabs = await chrome.tabs.query({ active: true });
          activeTab = allTabs && allTabs[0];
        }
        await ensureOffscreenDocument();
        chrome.desktopCapture.chooseDesktopMedia(
          ["screen", "window", "tab"],
          activeTab,
          (streamId) => {
            if (!streamId) {
              sendResponse({ ok: false, canceled: true, error: "Capture canceled by user." });
              return;
            }
            chrome.runtime.sendMessage({ type: "CAPTURE_STREAM", streamId }, (resp) => {
              if (resp && resp.ok && resp.dataUrl) {
                sendResponse({ ok: true, dataUrl: resp.dataUrl });
              } else {
                sendResponse({ ok: false, error: (resp && resp.error) || "Stream capture failed." });
              }
            });
          }
        );
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : "Failed to initiate screen capture." });
      }
    })();
    return true; // async response
  }

  return false;
});

async function ensureOffscreenDocument() {
  if (typeof chrome.offscreen === "undefined") return;
  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) return;
  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA"],
    justification: "Capturing a single frame screenshot of the selected screen or window."
  });
}

