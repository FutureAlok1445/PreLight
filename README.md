# PREflight

**File preparation and optimization before upload.**

PREflight is a lightweight, local-first Chrome extension (Manifest V3) that sits between **"Choose File"** and **"Upload"**. It intercepts file uploads on any website, allows interactive custom-size area screenshots, and provides a local workspace to review, compress, convert, merge, or clean files before they leave your browser.

Everything runs 100% locally in-memory on your machine. There is zero network transmission, zero telemetry, no backend, and no external compression services.

---

## 1. Core Product Principles

- **Zero Automatic Upload**: PREflight never continues or uploads modified files without your explicit confirmation.
- **Zero Automatic Navigation**: PREflight never redirects you or triggers unexpected page changes.
- **Original File Safe**: The original file is never overwritten, destroyed, or modified in-place.
- **Local-First & Private**: All image processing, PDF manipulation, and text parsing executes strictly in browser memory.
- **Times New Roman & Crisp Editorial Aesthetic**: Clean, professional layout, high-contrast monochrome palette, subtle borders, zero AI gradients.

---

## 2. Features

### A. Custom-Size Area Screenshot (Lightshot / Snipping Tool Style)
- **Select Area to Snip**: Click the extension icon and select "Select Area to Snip" to dim the screen and draw a rubber-band box over any section of the active webpage.
- **Live Dimensions Badge**: Displays exact pixel width and height (e.g., `640 × 480 px`) while dragging or adjusting corner handles.
- **High-DPI Retina Support**: Automatically scales with `window.devicePixelRatio` for razor-sharp crops.
- **Direct Workspace Handoff**: Hands off cropped screenshots directly into the local optimizer for instant compression, clipboard copy, or download.
- **Capture Tab**: Also supports instant full active-tab capture.

### B. 2-Step On-Page Upload Review (Any Website)
When selecting a file on any standard upload input on any website:
1. **Step 1 — Decision Card**:
   - Displays file name, detected format label, and exact size.
   - Highlights detected website upload limits (e.g. `Site limit detected: 5 MB`).
   - Gives explicit choices:
     - `[ Compress / Optimize ]` (or `[ Compress PDF ]` / `[ Clean Text ]`)
     - `[ Continue with Original ]`
     - `[ Cancel ]`
     - `Open in Full Workspace...`
2. **Step 2 — Confirmation Card**:
   - Displays a 3-column stats comparison: `Original Size`, `Optimized Size`, and `Saved %`.
   - Explains the result (or notes if the file was already optimal).
   - Gives explicit next actions:
     - `[ Continue Upload ]` (replaces input files via W3C DataTransfer and continues)
     - `[ Download ]` (saves processed file)
     - `[ Copy ]` (copies image to clipboard)
     - `← Back` (returns to decision card)

### C. Local PDF Tools (`pdf-lib`)
- **PDF Compress**: Locally optimizes cross-reference object streams, strips non-essential metadata, and removes unreferenced dictionary items while keeping all text, vectors, and pages intact.
- **PDF Split / Extract**: Specify page numbers or ranges (e.g. `1-3, 5, 8`) to extract pages into a new standalone PDF.
- **PDF Merge**: Multi-file queue with reordering controls (Move Up, Move Down, Remove) to combine multiple PDFs into one.
- **Text to PDF**: Paginated Helvetica generator with automated word wrapping.

### D. Text & CSV Intelligence
- **Structure Analysis**: Displays line count, word count, character count, and detects CSV delimiters (`,`, `;`, `\t`).
- **Clean Whitespace**: Removes excess trailing whitespace and empty lines without changing data.
- **CSV to JSON Export**: Converts tabular CSV data into structured JSON arrays locally.

### E. Universal Image Optimizer
- **Formats**: Auto, WebP, JPEG, PNG.
- **Quality Control**: Bounded compression slider (35% to 95%).
- **Dimension Constraints**: Original, 2400px, 1920px (1080p), 1280px (720p).
- **Visual Inspection**: Split Before (Original) vs. After (Optimized) preview tabs.
- **Clipboard Support**: One-click copy of optimized images to the system clipboard.

### F. Document Archive Inspection
- Transparently inspects package archives (e.g. DOCX, ODT) and preserves them intact without fake compression.

---

## 3. Project Architecture

```
preflight/
├── manifest.json              # Chrome Manifest V3 configuration
├── background.js              # Service worker (tab capture, area snip trigger, lazy injection)
│
├── core/
│   ├── utils.js               # Formatting, MIME classification, filename helpers, storage bridge
│   ├── file-analyzer.js       # Universal file metadata extraction & supported action resolution
│   ├── image-optimizer.js     # HTML5 Canvas / OffscreenCanvas image encoding & resize math
│   ├── smart-profile.js       # Deterministic heuristics for image quality & format selection
│   ├── pdf-processor.js       # Local PDF engine (compress, split, merge, text-to-pdf)
│   ├── text-processor.js      # Text analysis, whitespace cleaner, and CSV to JSON parser
│   ├── clipboard.js           # Async Clipboard API integration
│   └── downloader.js          # In-memory blob download triggers
│
├── upload/
│   ├── upload-detector.js     # Content script intercepting <input type="file"> on websites
│   ├── upload-ui.js           # Isolated Shadow DOM 2-step decision & confirmation card
│   └── area-snipper.js        # Interactive custom-size screenshot rubber-band overlay
│
├── popup/
│   ├── popup.html             # Toolbar launcher interface
│   ├── popup.css              # Times New Roman editorial styling
│   └── popup.js               # Area snip trigger, full tab capture, file drop & options
│
├── optimizer/
│   ├── optimizer.html         # Multi-tool workspace (Images, PDFs, Text/CSV, Docs)
│   ├── optimizer.css          # Clean monochrome workspace layout
│   └── optimizer.js           # Workspace controller wiring all local engines
│
├── lib/
│   └── pdf-lib.min.js         # Bundled standalone UMD PDF library (zero network requests)
│
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## 4. Performance & Security

- **Zero Remote Dependencies**: Works completely offline. No external CDN scripts, no tracking, and no external compression APIs.
- **Lazy Loading**: Initial content script injection is only ~45 KB. Heavy engines (like `pdf-lib`) are lazy-loaded on-demand via `chrome.scripting.executeScript` only when the user uploads a PDF and requests compression.
- **Memory Hygiene**: Automatically revokes Object URLs (`URL.revokeObjectURL`) on navigation and reset to prevent memory leaks.
- **No Dynamic Code Execution**: Compliant with strict Manifest V3 Content Security Policy (no `eval` or remote scripts).

---

## 5. Installation Instructions

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the upper-right corner.
4. Click **Load unpacked** in the top-left menu.
5. Select the `preflight` folder.
6. PREflight is now installed and active.

---

## 6. Testing Workflows

1. **On-Page Upload Review**:
   - Go to any website with a file upload (e.g. a portal or test form).
   - Select an image or PDF.
   - PREflight's review card appears in the lower-right corner.
   - Choose to compress, inspect the reduction stats, and explicitly confirm upload.
2. **Custom Area Snip**:
   - Click the PREflight extension icon in your Chrome toolbar.
   - Click **[ Select Area to Snip ]**.
   - Drag a box over any region on your active webpage and click **[ Snip & Optimize ]**.
   - The snip opens in the PREflight workspace for optimization, copying, or downloading.
3. **PDF Merge & Split**:
   - Open the PREflight popup and click **[ Add File ]**.
   - Load multiple PDFs to arrange order and merge them into a single PDF, or extract specific page ranges (e.g., `1-3`).
