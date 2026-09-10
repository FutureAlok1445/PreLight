/**
 * offscreen/offscreen.js
 * Offscreen document handling media stream capture via getUserMedia.
 * Consumes desktopCapture streamId, captures a single crystal-clear frame,
 * immediately shuts down the stream, and returns the PNG data URL.
 */
(function () {
  "use strict";

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "CAPTURE_STREAM") return false;

    captureStream(message.streamId)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : "Capture failed" }));

    return true; // async
  });

  async function captureStream(streamId) {
    if (!streamId) throw new Error("No stream identifier provided.");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: streamId,
          maxWidth: 3840,
          maxHeight: 2160
        }
      }
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject);
      };
      video.onerror = (e) => reject(new Error("Video playback error."));
    });

    // Allow frame rendering
    await new Promise((resolve) => setTimeout(resolve, 120));

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Immediately stop all media tracks so no screen recording indicator lingers
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch (e) {}
    });
    video.srcObject = null;

    return canvas.toDataURL("image/png");
  }
})();
