import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.mjs";

const fileInput = document.querySelector("#pdf-upload");
const runOcrButton = document.querySelector("#run-ocr");
const statusText = document.querySelector("#status");
const pdfContainer = document.querySelector("#pdf-container");
const ocrContainer = document.querySelector("#ocr-output");

let renderedCanvases = [];

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  clearView();

  if (!file) {
    statusText.textContent = "No PDF selected.";
    return;
  }

  runOcrButton.disabled = true;
  statusText.textContent = "Loading and rendering PDF...";

  try {
    const data = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    renderedCanvases = await renderPdfPages(pdfDoc);
    statusText.textContent = `Rendered ${renderedCanvases.length} page(s). Click Run OCR.`;
    runOcrButton.disabled = renderedCanvases.length === 0;
  } catch (error) {
    console.error(error);
    statusText.textContent = "Unable to read that PDF. Please try another file.";
  }
});

runOcrButton.addEventListener("click", async () => {
  if (!renderedCanvases.length) return;

  runOcrButton.disabled = true;
  ocrContainer.innerHTML = "";

  try {
    for (const [index, canvas] of renderedCanvases.entries()) {
      statusText.textContent = `Running OCR on page ${index + 1} of ${renderedCanvases.length}...`;
      const result = await Tesseract.recognize(canvas, "eng", {
        logger: ({ status, progress }) => {
          if (status === "recognizing text") {
            const pct = Math.round(progress * 100);
            statusText.textContent = `OCR page ${index + 1}: ${pct}%`;
          }
        },
      });

      const pageOutput = document.createElement("article");
      pageOutput.className = "page-output";
      pageOutput.innerHTML = `<h3>Page ${index + 1}</h3><pre>${escapeHtml(result.data.text.trim() || "(No text detected)")}</pre>`;
      ocrContainer.appendChild(pageOutput);
    }

    statusText.textContent = "OCR complete.";
  } catch (error) {
    console.error(error);
    statusText.textContent = "OCR failed. Check console for details.";
  } finally {
    runOcrButton.disabled = false;
  }
});

async function renderPdfPages(pdfDoc) {
  const canvases = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum += 1) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
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

    canvases.push(canvas);
  }

  return canvases;
}

function clearView() {
  pdfContainer.innerHTML = "";
  ocrContainer.innerHTML = "";
  renderedCanvases = [];
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
