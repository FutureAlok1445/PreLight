/**
 * core/smart-profile.js
 * Deterministic "Smart Optimization" decision logic.
 *
 * This is intentionally simple, rule-based heuristics -- NOT machine
 * learning and NOT an external/AI call. It looks at format, size,
 * dimensions, and a cheap local "is this a photo or a flat/text
 * graphic" sample (computed by image-optimizer.js via canvas) to pick
 * a sensible starting point. The user can always override it.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const { MIN_WORTHWHILE_BYTES, MIN_MEANINGFUL_REDUCTION } = Preflight.constants;
  const { formatBytes } = Preflight.utils;

  // Long-edge threshold above which Smart mode will consider downscaling.
  const LARGE_EDGE_PX = 3600;
  const LARGE_EDGE_TARGET_PX = 2400;

  // Rough bytes-per-pixel table used only to produce a pre-encode
  // *estimate* shown to the user before we actually run the encoder.
  // The real, authoritative number always comes from the actual
  // encoded Blob afterwards (see image-optimizer.js).
  const BPP_TABLE = {
    "image/webp": { photo: 0.30, graphic: 0.16 },
    "image/jpeg": { photo: 0.45, graphic: 0.30 },
    "image/png": { photo: 1.1, graphic: 0.55 }
  };

  /**
   * determineStrategy(meta, options)
   *  meta: result of fileAnalyzer.analyzeImage()
   *  options: {
   *    contentHint: 'photo' | 'graphic' | 'unknown'  (from a cheap pixel sample)
   *    targetBytes: number | null   (an upload limit to aim for, if known)
   *  }
   * Returns a plain strategy object -- never mutates input.
   */
  function determineStrategy(meta, options) {
    const opts = options || {};
    const contentHint = opts.contentHint || "unknown";
    const targetBytes = opts.targetBytes || null;

    // 1. No-op guard: tiny files rarely benefit and risk visible loss
    //    for no real gain.
    if (meta.size <= MIN_WORTHWHILE_BYTES) {
      return skipStrategy(meta, "This file is already small.");
    }

    // 2. Pick an output format.
    let format = "image/webp";
    if (meta.type === "image/png" && contentHint === "graphic" && meta.size < 200 * 1024) {
      // Small, flat, already-compact PNG (e.g. an icon) -- WebP savings
      // would be marginal and PNG keeps crisp flat edges.
      format = "image/png";
    }

    // 3. Pick a baseline quality (ignored for PNG, which is lossless).
    let quality = contentHint === "photo" ? 78 : 88;
    if (meta.type === "image/webp") {
      // Already WebP -- nudge quality down a little rather than
      // re-picking a format, since re-encoding WebP->WebP at the same
      // quality buys nothing.
      quality = clampQuality(quality - 6);
    }

    // 4. Pick a resize target only when the image is unusually large.
    const longEdge = Math.max(meta.width, meta.height);
    let maxDimension = null;
    if (longEdge > LARGE_EDGE_PX) {
      maxDimension = LARGE_EDGE_TARGET_PX;
    }

    // 5. If the caller knows the site's upload limit, aim for it later
    //    via the bounded target-size search in image-optimizer.js --
    //    here we just record the target.
    const strategy = {
      skip: false,
      format,
      quality: clampQuality(quality),
      maxDimension,
      targetBytes,
      estimatedBytes: estimateBytes(meta, format, quality, maxDimension),
      reason: null
    };

    return strategy;
  }

  function skipStrategy(meta, reason) {
    return {
      skip: true,
      format: meta.type,
      quality: null,
      maxDimension: null,
      targetBytes: null,
      estimatedBytes: meta.size,
      reason
    };
  }

  /**
   * Given an already-encoded result, decide whether the savings were
   * meaningful enough to present as "optimized" rather than "already
   * optimized / no change worth keeping".
   */
  function isMeaningfulReduction(originalBytes, optimizedBytes) {
    if (optimizedBytes >= originalBytes) return false;
    const reduction = (originalBytes - optimizedBytes) / originalBytes;
    return reduction >= MIN_MEANINGFUL_REDUCTION;
  }

  function estimateBytes(meta, format, quality, maxDimension) {
    const table = BPP_TABLE[format] || BPP_TABLE["image/webp"];
    const contentKey = quality && quality < 82 ? "photo" : "graphic";
    const bpp = table[contentKey];

    let { width, height } = meta;
    if (maxDimension && Math.max(width, height) > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const qualityFactor = format === "image/png" ? 1 : clamp01(quality / 100) * 0.9 + 0.35;
    const estimate = Math.round(width * height * bpp * qualityFactor);
    return Math.max(estimate, 4 * 1024);
  }

  function clampQuality(q) {
    return Math.min(95, Math.max(35, Math.round(q)));
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  Preflight.smartProfile = {
    determineStrategy,
    isMeaningfulReduction,
    estimateBytes,
    formatEstimate: (bytes) => formatBytes(bytes)
  };
})(typeof window !== "undefined" ? window : globalThis);
