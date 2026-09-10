/**
 * core/downloader.js
 * Saves a Blob to disk using a plain <a download> link. This avoids
 * requesting the "downloads" permission entirely -- it works exactly
 * like a normal webpage download, which is all this extension needs.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});

  function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser a moment to pick up the blob URL before revoking it.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  Preflight.downloader = { downloadFile };
})(typeof window !== "undefined" ? window : globalThis);
