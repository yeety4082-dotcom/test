import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.mjs";

const OCR_RENDER_SCALE = 1.5;

const fileInput = document.querySelector("#pdf-upload");
const runOcrButton = document.querySelector("#run-ocr");
const applyCorrectionsButton = document.querySelector("#apply-corrections");
const statusText = document.querySelector("#status");
const pdfContainer = document.querySelector("#pdf-container");
const ocrContainer = document.querySelector("#ocr-output");

let renderedPages = [];
let ocrPageData = [];
let correctionRules = [];

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
  correctionRules = [];

  try {
    for (const [index, page] of renderedPages.entries()) {
      statusText.textContent = `Running OCR on page ${index + 1} of ${renderedPages.length}...`;
      const result = await Tesseract.recognize(page.canvas, "eng", {
        logger: ({ status, progress }) => {
          if (status === "recognizing text") {
            const pct = Math.round(progress * 100);
            statusText.textContent = `OCR page ${index + 1}: ${pct}%`;
          }
        },
      });

      const pageData = createEditablePageOutput({
        pageIndex: index,
        sourcePage: page,
        words: result.data.words || [],
      });
      ocrPageData.push(pageData);
      ocrContainer.appendChild(pageData.node);
    }

    applyCorrectionsButton.disabled = ocrPageData.length < 2;
    statusText.textContent = "OCR complete. Edit page text directly, then apply edits to remaining pages.";
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
  const editedTokens = collectEditedTokens(sourcePage);
  correctionRules = buildCorrectionRules(sourcePage.originalTokens, editedTokens);

  if (!correctionRules.length) {
    statusText.textContent = "No edits detected on page 1. Update text and try again.";
    return;
  }

  for (let index = 1; index < ocrPageData.length; index += 1) {
    const page = ocrPageData[index];
    applyCorrectionsToPage(page, correctionRules);
  }

  statusText.textContent = `Applied ${correctionRules.length} correction rule(s) from page 1 to ${ocrPageData.length - 1} page(s).`;
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

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    const wrapper = document.createElement("article");
    wrapper.className = "page-preview";
    wrapper.innerHTML = `<h3>Page ${pageNum}</h3>`;
    wrapper.appendChild(canvas);
    pdfContainer.appendChild(wrapper);

    pages.push({ canvas, viewport, pageNumber: pageNum });
  }

  return pages;
}

function createEditablePageOutput({ pageIndex, sourcePage, words }) {
  const pageOutput = document.createElement("article");
  pageOutput.className = "page-output";

  const heading = document.createElement("h3");
  heading.textContent = `Page ${pageIndex + 1}`;
  pageOutput.appendChild(heading);

  const editor = document.createElement("div");
  editor.className = "ocr-editor";
  editor.dataset.page = String(pageIndex + 1);
  editor.style.width = `${sourcePage.canvas.width}px`;
  editor.style.height = `${sourcePage.canvas.height}px`;

  const originalTokens = [];

  words.forEach((word, wordIndex) => {
    const token = createToken(word, wordIndex);
    if (!token) return;

    originalTokens.push(token.text);

    const span = document.createElement("span");
    span.className = "ocr-token";
    span.contentEditable = "true";
    span.spellcheck = true;
    span.dataset.index = String(wordIndex);
    span.dataset.original = token.text;
    span.textContent = token.text;

    positionToken(span, token, sourcePage.canvas.height);
    editor.appendChild(span);
  });

  if (!editor.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "empty-page";
    empty.textContent = "(No text detected)";
    pageOutput.appendChild(empty);
  } else {
    pageOutput.appendChild(editor);
  }

  pageOutput.dataset.originalTokens = JSON.stringify(originalTokens);

  return {
    node: pageOutput,
    editor,
    originalTokens,
  };
}

function createToken(word, index) {
  const text = (word?.text || "").trim();
  if (!text) return null;

  const bbox = word.bbox || {};
  const x0 = Number.isFinite(bbox.x0) ? bbox.x0 : 0;
  const x1 = Number.isFinite(bbox.x1) ? bbox.x1 : x0 + 1;
  const y0 = Number.isFinite(bbox.y0) ? bbox.y0 : 0;
  const y1 = Number.isFinite(bbox.y1) ? bbox.y1 : y0 + 1;

  return {
    index,
    text,
    x0,
    x1,
    y0,
    y1,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  };
}

function positionToken(span, token, canvasHeight) {
  const fontSize = Math.max(10, token.height * 0.92);
  span.style.left = `${token.x0}px`;
  span.style.top = `${Math.max(0, token.y0)}px`;
  span.style.width = `${Math.max(token.width, token.text.length * fontSize * 0.45)}px`;
  span.style.minHeight = `${token.height}px`;
  span.style.fontSize = `${fontSize}px`;
  span.style.lineHeight = `${token.height}px`;
  span.style.maxWidth = `${Math.max(16, canvasHeight)}px`;
}

function collectEditedTokens(pageData) {
  if (!pageData.editor) return [];

  return [...pageData.editor.querySelectorAll(".ocr-token")].map((tokenNode) =>
    normalizeTokenText(tokenNode.textContent),
  );
}

function buildCorrectionRules(originalTokens, editedTokens) {
  const rules = new Map();

  for (let index = 0; index < originalTokens.length; index += 1) {
    const original = normalizeTokenText(originalTokens[index]);
    const edited = normalizeTokenText(editedTokens[index] || "");

    if (!original || !edited || original === edited) continue;
    rules.set(original.toLowerCase(), edited);
  }

  return [...rules.entries()].map(([source, target]) => ({ source, target }));
}

function applyCorrectionsToPage(pageData, rules) {
  if (!pageData.editor) return;

  const tokens = [...pageData.editor.querySelectorAll(".ocr-token")];

  tokens.forEach((tokenNode) => {
    const current = normalizeTokenText(tokenNode.textContent);
    if (!current) return;

    const match = rules.find((rule) => rule.source === current.toLowerCase());
    if (!match) return;

    tokenNode.textContent = preserveCasing(current, match.target);
    tokenNode.dataset.corrected = "true";
  });
}

function preserveCasing(original, replacement) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }

  return replacement;
}

function normalizeTokenText(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function clearView() {
  pdfContainer.innerHTML = "";
  ocrContainer.innerHTML = "";
  renderedPages = [];
  ocrPageData = [];
  correctionRules = [];
  applyCorrectionsButton.disabled = true;
}
