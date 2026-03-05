import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.mjs";

const OCR_RENDER_SCALE = 1.2;

const fileInput = document.querySelector("#pdf-upload");
const runOcrButton = document.querySelector("#run-ocr");
const applyCorrectionsButton = document.querySelector("#apply-corrections");
const statusText = document.querySelector("#status");
const pdfContainer = document.querySelector("#pdf-container");
const ocrContainer = document.querySelector("#ocr-output");

let renderedPages = [];
let ocrPageData = [];

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  clearView();

  if (!file) {
    statusText.textContent = "No PDF selected.";
    return;
  }

  runOcrButton.disabled = true;
  applyCorrectionsButton.disabled = true;
  statusText.textContent = "Loading and rendering PDF...";

  try {
    const data = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    renderedPages = await renderPdfPages(pdfDoc);
    statusText.textContent = `Rendered ${renderedPages.length} page(s). Click Run OCR.`;
    runOcrButton.disabled = renderedPages.length === 0;
  } catch (error) {
    console.error(error);
    statusText.textContent = "Unable to read that PDF. Please try another file.";
  }
});

runOcrButton.addEventListener("click", async () => {
  if (!renderedPages.length) return;

  runOcrButton.disabled = true;
  applyCorrectionsButton.disabled = true;
  ocrContainer.innerHTML = "";
  ocrPageData = [];

  try {
    for (const [index, page] of renderedPages.entries()) {
      statusText.textContent = `Running OCR on page ${index + 1} of ${renderedPages.length}...`;
      const result = await Tesseract.recognize(page.canvas, "eng", {
        logger: ({ status, progress }) => {
          if (status === "recognizing text") {
            statusText.textContent = `OCR page ${index + 1}: ${Math.round(progress * 100)}%`;
          }
        },
      });

      const pageData = createEditablePageOutput({
        pageIndex: index,
        words: result.data.words || [],
        lines: result.data.lines || [],
      });

      ocrPageData.push(pageData);
      ocrContainer.appendChild(pageData.node);
    }

    applyCorrectionsButton.disabled = ocrPageData.length < 2;
    statusText.textContent = "OCR complete. Edit page 1 text, then apply edits to remaining pages.";
  } catch (error) {
    console.error(error);
    statusText.textContent = "OCR failed. Check console for details.";
  } finally {
    runOcrButton.disabled = false;
  }
});

applyCorrectionsButton.addEventListener("click", () => {
  if (!ocrPageData.length) return;

  const sourcePage = ocrPageData[0];
  const editedTokens = tokenize(sourcePage.editor?.innerText || "");
  const rules = buildCorrectionRules(sourcePage.originalTokens, editedTokens);

  if (!rules.length) {
    statusText.textContent = "No edits detected on page 1. Update the text and try again.";
    return;
  }

  for (let i = 1; i < ocrPageData.length; i += 1) {
    applyCorrectionsToPage(ocrPageData[i], rules);
  }

  statusText.textContent = `Applied ${rules.length} correction rule(s) from page 1 to ${ocrPageData.length - 1} page(s).`;
});

async function renderPdfPages(pdfDoc) {
  const pages = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum += 1) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: context, viewport }).promise;

    const wrapper = document.createElement("article");
    wrapper.className = "page-preview";
    wrapper.innerHTML = `<h3>Page ${pageNum}</h3>`;
    wrapper.appendChild(canvas);
    pdfContainer.appendChild(wrapper);

    pages.push({ canvas });
  }

  return pages;
}

function createEditablePageOutput({ pageIndex, words, lines }) {
  const pageOutput = document.createElement("article");
  pageOutput.className = "page-output";

  const heading = document.createElement("h3");
  heading.textContent = `Page ${pageIndex + 1}`;
  pageOutput.appendChild(heading);

  const editor = document.createElement("div");
  editor.className = "ocr-editor";

  const originalTokens = words
    .map((word) => normalizeTokenText(word.text || ""))
    .filter(Boolean);

  if (lines.length) {
    lines.forEach((line) => {
      const lineText = normalizeSpacing(line.text || "");
      if (!lineText) return;

      const lineNode = document.createElement("div");
      lineNode.className = "ocr-line";
      lineNode.contentEditable = "true";
      lineNode.spellcheck = true;
      lineNode.textContent = lineText;
      lineNode.style.fontSize = `${computeLineFontSize(line)}px`;
      editor.appendChild(lineNode);
    });
  } else {
    const fallback = document.createElement("div");
    fallback.className = "ocr-line";
    fallback.contentEditable = "true";
    fallback.spellcheck = true;
    fallback.textContent = normalizeSpacing(words.map((word) => word.text || "").join(" ")) || "(No text detected)";
    fallback.style.fontSize = "14px";
    editor.appendChild(fallback);
  }

  pageOutput.appendChild(editor);

  return { node: pageOutput, editor, originalTokens };
}

function computeLineFontSize(line) {
  const bbox = line?.bbox || {};
  const y0 = Number.isFinite(bbox.y0) ? bbox.y0 : 0;
  const y1 = Number.isFinite(bbox.y1) ? bbox.y1 : y0 + 16;
  const height = Math.max(8, y1 - y0);
  return clamp(height * 0.78, 11, 20);
}

function buildCorrectionRules(originalTokens, editedTokens) {
  const rules = new Map();
  const length = Math.min(originalTokens.length, editedTokens.length);

  for (let i = 0; i < length; i += 1) {
    const original = normalizeTokenText(originalTokens[i]);
    const edited = normalizeTokenText(editedTokens[i]);
    if (!original || !edited || original === edited) continue;
    rules.set(original.toLowerCase(), edited);
  }

  return [...rules.entries()].map(([source, target]) => ({ source, target }));
}

function applyCorrectionsToPage(pageData, rules) {
  if (!pageData.editor) return;

  const lines = [...pageData.editor.querySelectorAll(".ocr-line")];
  lines.forEach((lineNode) => {
    let text = lineNode.textContent || "";

    for (const rule of rules) {
      const regex = new RegExp(`\\b${escapeRegExp(rule.source)}\\b`, "gi");
      text = text.replace(regex, (match) => preserveCasing(match, rule.target));
    }

    lineNode.textContent = text;
    lineNode.dataset.corrected = "true";
  });
}

function preserveCasing(original, replacement) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original === original.toLowerCase()) return replacement.toLowerCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function tokenize(text) {
  return normalizeSpacing(text)
    .split(" ")
    .map((token) => normalizeTokenText(token))
    .filter(Boolean);
}

function normalizeSpacing(text) {
  return (text || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTokenText(text) {
  return normalizeSpacing(text)
    .replace(/^[^\w]+/u, "")
    .replace(/[^\w]+$/u, "");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clearView() {
  pdfContainer.innerHTML = "";
  ocrContainer.innerHTML = "";
  renderedPages = [];
  ocrPageData = [];
  applyCorrectionsButton.disabled = true;
}
