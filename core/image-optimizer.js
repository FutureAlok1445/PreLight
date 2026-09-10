/**
 * core/image-optimizer.js
 * The actual compression engine. Uses only browser-native APIs:
 * createImageBitmap + (Offscreen)Canvas + toBlob/convertToBlob.
 * No external image-processing library is used or needed for the
 * PNG/JPEG/WebP cases this extension supports.
 *
 * Pipeline: File -> ImageBitmap -> (optional resize) -> encode -> Blob
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const { isSupportedImageFile, buildOutputFilename } = Preflight.utils;
  const { MAX_DIMENSION } = Preflight.constants;
  const { isMeaningfulReduction } = Preflight.smartProfile;

  const MAX_ENCODE_ATTEMPTS = 12; // hard bound for the target-size search
  const QUALITY_LADDER = [90, 85, 80, 75, 70, 65, 60];

  class OptimizationError extends Error {
    constructor(message) {
      super(message);
      this.name = "OptimizationError";
    }
  }

  /** Creates a canvas-like surface that supports drawImage + blob export. */
  function makeSurface(width, height) {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(width, height);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function surfaceToBlob(surface, mime, quality) {
    if (typeof surface.convertToBlob === "function") {
      return surface.convertToBlob(
        mime === "image/png" ? { type: mime } : { type: mime, quality: quality / 100 }
      );
    }
    return new Promise((resolve, reject) => {
      surface.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new OptimizationError("Encoding failed."))),
        mime,
        mime === "image/png" ? undefined : quality / 100
      );
    });
  }

  function computeTargetDimensions(width, height, maxDimension) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return { width: 1, height: 1 };
    }
    const targetCap = Number.isFinite(maxDimension) && maxDimension > 0 ? maxDimension : MAX_DIMENSION;
    const cap = Math.min(targetCap, MAX_DIMENSION);
    const longEdge = Math.max(width, height);
    if (longEdge <= cap) {
      return { width: Math.round(width), height: Math.round(height) };
    }
    const scale = cap / longEdge;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  /**
   * Cheap, local, deterministic guess at whether an image is a photo
   * or a flat/UI/text graphic, used only to bias quality defaults.
   * Downsamples to a tiny canvas and looks at color diversity --
   * no AI, no network call.
   */
  async function sampleContentHint(bitmap) {
    try {
      const size = 32;
      const surface = makeSurface(size, size);
      const ctx = surface.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      const buckets = new Set();
      let alphaVariance = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Quantize to 4 bits per channel -> 4096 possible buckets.
        const r = data[i] >> 4;
        const g = data[i + 1] >> 4;
        const b = data[i + 2] >> 4;
        buckets.add((r << 8) | (g << 4) | b);
        alphaVariance += data[i + 3] < 250 ? 1 : 0;
      }
      const totalPixels = size * size;
      const diversity = buckets.size / totalPixels;
      // Flat UI/text screenshots tend to reuse a small palette;
      // photos tend to use a much wider spread of quantized colors.
      return diversity > 0.35 ? "photo" : "graphic";
    } catch (err) {
      return "unknown";
    }
  }

  async function drawBitmapToBlob(bitmap, { width, height, format, quality, hasAlpha }) {
    const surface = makeSurface(width, height);
    const ctx = surface.getContext("2d");

    // JPEG has no alpha channel -- flatten onto white so transparent
    // areas don't turn black/garbled.
    if (format === "image/jpeg" && hasAlpha) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    return surfaceToBlob(surface, format, quality);
  }

  async function detectAlpha(bitmap) {
    try {
      const size = 16;
      const surface = makeSurface(size, size);
      const ctx = surface.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  /**
   * optimizeImage(file, options)
   *  options: { format, quality, maxDimension, targetBytes }
   * Returns:
   *  {
   *    file, blob, originalSize, optimizedSize, reductionPercent,
   *    width, height, format, quality, alreadyOptimized, metTarget
   *  }
   */
  async function optimizeImage(file, options) {
    if (!isSupportedImageFile(file)) {
      throw new OptimizationError("Unsupported image format.");
    }
    const opts = options || {};
    const format = opts.format || "image/webp";
    const requestedQuality = opts.quality || 82;
    const maxDimension = opts.maxDimension || null;
    const targetBytes = opts.targetBytes || null;

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (err) {
      throw new OptimizationError("Optimization failed. Your original file is unchanged.");
    }

    try {
      const hasAlpha = format === "image/jpeg" ? await detectAlpha(bitmap) : false;
      const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, maxDimension);

      let blob, quality, attempts, metTarget;
      if (targetBytes) {
        ({ blob, quality, attempts, metTarget } = await targetSizeSearch(bitmap, {
          width,
          height,
          format,
          hasAlpha,
          targetBytes
        }));
      } else {
        blob = await drawBitmapToBlob(bitmap, { width, height, format, quality: requestedQuality, hasAlpha });
        quality = format === "image/png" ? null : requestedQuality;
        attempts = 1;
        metTarget = true;
      }

      const meaningful = isMeaningfulReduction(file.size, blob.size);
      const outputName = buildOutputFilename(file.name, format);

      // If the "optimization" didn't actually help, don't hand back a
      // needlessly degraded copy -- surface the original instead.
      const finalBlob = meaningful ? blob : file;
      const finalName = meaningful ? outputName : file.name;
      const finalType = meaningful ? format : file.type;

      const optimizedFile = new File([finalBlob], finalName, { type: finalType });

      return {
        file: optimizedFile,
        blob: finalBlob,
        originalSize: file.size,
        optimizedSize: finalBlob.size,
        reductionPercent: file.size > 0 ? Math.max(0, (file.size - finalBlob.size) / file.size) : 0,
        width,
        height,
        format: finalType,
        quality: meaningful ? quality : null,
        alreadyOptimized: !meaningful,
        metTarget,
        attempts
      };
    } finally {
      bitmap.close();
    }
  }

  /**
   * Bounded quality/size search used for "optimize toward an upload
   * limit". Tries a fixed quality ladder (max ~7 encodes); if nothing
   * fits, tries one dimension step-down and repeats a shorter ladder.
   * Total encode attempts are capped by MAX_ENCODE_ATTEMPTS.
   */
  async function targetSizeSearch(bitmap, { width, height, format, hasAlpha, targetBytes }) {
    let attempts = 0;
    let best = null; // highest-quality result that still fits the target
    let smallest = null; // smallest result seen, as a fallback

    async function tryQuality(w, h, q) {
      if (attempts >= MAX_ENCODE_ATTEMPTS) return null;
      attempts += 1;
      return await drawBitmapToBlob(bitmap, { width: w, height: h, format, quality: q, hasAlpha });
    }

    // For lossless PNG, quality parameter is ignored by canvas.
    // Use a single attempt at full resolution, followed by bounded downscaling if needed.
    const ladder = format === "image/png" ? [null] : QUALITY_LADDER;

    for (const q of ladder) {
      const blob = await tryQuality(width, height, q || 82);
      if (!blob) break;
      if (!smallest || blob.size < smallest.blob.size) {
        smallest = { blob, quality: q, width, height };
      }
      if (blob.size <= targetBytes) {
        best = { blob, quality: q, width, height };
        break; // ladder is descending quality -> first fit is the best fit
      }
    }

    if (!best && attempts < MAX_ENCODE_ATTEMPTS) {
      // Step-down in resolution (75% and 50% if needed)
      const scaleSteps = format === "image/png" ? [0.75, 0.5] : [0.75];
      for (const scale of scaleSteps) {
        const scaledW = Math.max(1, Math.round(width * scale));
        const scaledH = Math.max(1, Math.round(height * scale));
        const subLadder = format === "image/png" ? [null] : [80, 70, 60];
        for (const q of subLadder) {
          const blob = await tryQuality(scaledW, scaledH, q || 82);
          if (!blob) break;
          if (!smallest || blob.size < smallest.blob.size) {
            smallest = { blob, quality: q, width: scaledW, height: scaledH };
          }
          if (blob.size <= targetBytes) {
            best = { blob, quality: q, width: scaledW, height: scaledH };
            break;
          }
        }
        if (best || attempts >= MAX_ENCODE_ATTEMPTS) break;
      }
    }

    const chosen = best || smallest;
    if (!chosen || !chosen.blob) {
      throw new OptimizationError("Could not produce a compressed image meeting the requested constraints.");
    }

    return {
      blob: chosen.blob,
      quality: chosen.quality,
      attempts,
      metTarget: !!best
    };
  }

  Preflight.imageOptimizer = {
    optimizeImage,
    sampleContentHint,
    OptimizationError,
    computeTargetDimensions
  };
})(typeof window !== "undefined" ? window : globalThis);
