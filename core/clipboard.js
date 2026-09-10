/**
 * core/clipboard.js
 * Writes an image Blob to the system clipboard using the standard
 * Async Clipboard API (navigator.clipboard.write + ClipboardItem).
 *
 * This must be called synchronously in response to a user gesture
 * (a click handler), or the browser will reject it.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});

  const CLIPBOARD_SAFE_TYPES = ["image/png"]; // widest paste-target support

  function isClipboardImageSupported() {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.clipboard &&
      typeof navigator.clipboard.write === "function" &&
      typeof global.ClipboardItem === "function"
    );
  }

  /**
   * Copies a blob to the clipboard as an image.
   * Most apps that accept pasted images expect PNG, and Chrome's
   * ClipboardItem support for image/webp and image/jpeg is
   * inconsistent across platforms, so if the optimized blob isn't
   * PNG we transparently re-encode a PNG copy just for the clipboard
   * write -- the downloaded/uploaded file is unaffected.
   */
  async function copyImageToClipboard(blob) {
    if (!isClipboardImageSupported()) {
      return {
        ok: false,
        message: "Clipboard image copy is not supported in this context."
      };
    }

    try {
      const pngBlob = CLIPBOARD_SAFE_TYPES.includes(blob.type)
        ? blob
        : await toPng(blob);

      const item = new ClipboardItem({ [pngBlob.type]: pngBlob });
      await navigator.clipboard.write([item]);
      return { ok: true, message: "Copied optimized image." };
    } catch (err) {
      return {
        ok: false,
        message: "Could not copy the image. Try Download instead."
      };
    }
  }

  async function toPng(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      const surface =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(bitmap.width, bitmap.height)
          : Object.assign(document.createElement("canvas"), {
              width: bitmap.width,
              height: bitmap.height
            });
      const ctx = surface.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      if (typeof surface.convertToBlob === "function") {
        return await surface.convertToBlob({ type: "image/png" });
      }
      return await new Promise((resolve, reject) => {
        surface.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG conversion failed."))), "image/png");
      });
    } finally {
      bitmap.close();
    }
  }

  Preflight.clipboard = { copyImageToClipboard, isClipboardImageSupported };
})(typeof window !== "undefined" ? window : globalThis);
