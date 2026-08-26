"use client";

/* CSS to merge into globals.css: none — this module renders no UI. */

/* OCR for image documents: pull the text out of a screenshot or photo so it
 * can be searched, tagged and embedded like any note.
 *
 * tesseract.js is loaded with a dynamic import() so its worker + WASM code
 * stays out of the main bundle — most sessions never OCR anything. The first
 * run also fetches the English language data (~15 MB, cached by the browser
 * afterwards), which is why every failure path here talks about downloads.
 * Runs entirely in the browser; the image never leaves the machine. */

const DOWNLOAD_MSG = "OCR needs a one-time ~15MB download — check your connection.";

/* tesseract.js reports per-phase progress (each phase restarts at 0), so map
 * its named phases onto one monotonic 0..1 for a single progress bar.
 * Phase names are stable across v5 and v6. */
const PHASES = [
  ["loading tesseract core", 0.0, 0.15],
  ["initializing tesseract", 0.15, 0.2],
  ["loading language traineddata", 0.2, 0.5],
  ["initializing api", 0.5, 0.6],
  ["recognizing text", 0.6, 1.0],
];

/* Tesseract's WASM decoders read raster formats only — an SVG (or webp, or a
 * transparent PNG) must go through the browser first. Rasterizing everything
 * onto a white canvas normalizes all of that, and upscaling small images
 * meaningfully improves recognition. */
async function rasterize(url) {
  const img = new Image();
  img.decoding = "async";
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error("Couldn't load that image — the file may be damaged."));
    img.src = url;
  });
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("Couldn't load that image — the file may be damaged.");
  const scale = Math.min(2, Math.max(1, 1600 / Math.max(w, h)));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

/**
 * Extract plain text from an image.
 * @param {string} dataUrlOrBlobUrl  a data: or blob: URL (any format the browser renders)
 * @param {(p: number) => void} [onProgress]  overall progress, 0..1, non-decreasing
 * @returns {Promise<string>} the recognized text, trimmed ("" if none found)
 * @throws {Error} with a human message — never raw library/stack text
 */
export async function extractTextFromImage(dataUrlOrBlobUrl, onProgress) {
  let Tesseract;
  try {
    const mod = await import("tesseract.js");
    Tesseract = mod.default || mod;
  } catch {
    // chunk fetch failed: offline, or the package isn't installed yet
    throw new Error(DOWNLOAD_MSG);
  }

  let last = 0;
  const report = (m) => {
    if (typeof onProgress !== "function" || !m || !m.status) return;
    const phase = PHASES.find(([name]) => m.status === name);
    if (!phase) return; // unknown phase (version drift) — skip, never crash
    const p = Math.max(0, Math.min(1, Number(m.progress) || 0));
    const overall = phase[1] + (phase[2] - phase[1]) * p;
    if (overall <= last) return; // phases can interleave across workers — stay monotonic
    last = overall;
    try { onProgress(overall); } catch {}
  };

  /* outside the try below: rasterize errors carry their own human message
   * and must not be remapped to the download hint */
  const png = await rasterize(dataUrlOrBlobUrl);

  try {
    /* Tesseract.recognize spins up a worker, recognizes, and terminates it —
     * right for occasional one-shot use, and identical in v5 and v6.
     * Worker, WASM core and English data are served from OUR origin
     * (public/ocr/, staged from the npm packages) — no CDN at runtime,
     * matching the app's local-first promise. */
    const { data } = await Tesseract.recognize(png, "eng", {
      logger: report,
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",     // loader appends the right tesseract-core-*.wasm.js for this browser
      langPath: "/ocr",     // eng.traineddata.gz alongside
    });
    if (typeof onProgress === "function") {
      try { onProgress(1); } catch {}
    }
    return (data?.text || "").trim();
  } catch (err) {
    /* The dominant failure is the language-data fetch (first run, offline, or
     * a blocked CDN) — tesseract's own message for it is unhelpful. */
    const msg = String((err && err.message) || err || "");
    if (/network|fetch|load|download|traineddata|wasm|importScripts|cors|http/i.test(msg)) {
      throw new Error(DOWNLOAD_MSG);
    }
    throw new Error("Couldn't read text from that image — try a sharper, higher-contrast one.");
  }
}
