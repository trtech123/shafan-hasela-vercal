import html2canvas from "html2canvas";
import jsPDF from "jspdf";

// Each source pixel is used once. Ordinary rows/sections remain together;
// oversized sections use their individual text-line boundaries instead.
export function paginateQuote(height, pageHeight, blocks = []) {
  if (!(height > 0) || !(pageHeight > 0)) throw new Error("invalid_pdf_dimensions");
  const pages = [];
  let top = 0;
  while (top < height) {
    let end = Math.min(top + pageHeight, height);
    let previous;
    do {
      previous = end;
      for (const block of blocks) {
        const start = Math.floor(block.top);
        const bottom = Math.ceil(block.bottom);
        if (bottom - start <= pageHeight && start > top && start < end && bottom > end) end = start;
      }
    } while (end < previous);
    pages.push({ top, height: end - top });
    if (pages.length > 100) throw new Error("pdf_too_many_pages");
    top = end;
  }
  return pages;
}

// html2canvas can position glyphs slightly outside DOM Range rectangles.
// For oversized paragraphs, choose an actual blank raster row at the page end.
export function findQuotePageCut({ width, height, data }, scale) {
  let blank = 0;
  for (let y = height - 1; y >= Math.max(0, height - Math.ceil(60 * scale)); y--) {
    let ink = false;
    for (let x = Math.ceil(4 * scale); x < width - Math.ceil(4 * scale); x++) {
      const i = (y * width + x) * 4;
      const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (data[i + 3] > 0 && luminance < 200) { ink = true; break; }
    }
    blank = ink ? 0 : blank + 1;
    if (blank >= Math.ceil(3 * scale)) return Math.floor((y + blank / 2) / scale);
  }
  throw new Error("pdf_no_safe_page_break");
}

export async function buildQuotePdf(element, { signal = undefined } = {}) {
  if (!element) throw new Error("missing_document");
  const clone = element.cloneNode(true);
  Object.assign(clone.style, { position: "absolute", left: "-10000px", top: "0", width: "794px", maxWidth: "none", overflow: "visible" });
  clone.setAttribute("aria-hidden", "true");
  document.body.appendChild(clone);
  const removeClone = () => clone.remove();
  signal?.addEventListener("abort", removeClone, { once: true });
  try {
    let assetTimer;
    try { await Promise.race([Promise.all([document.fonts?.ready, ...Array.from(clone.querySelectorAll("img")).map(async image => {
      try { await image.decode(); } catch { /* A missing optional image must not hide the quotation text. */ }
    })]), new Promise(resolve => { assetTimer = setTimeout(resolve, 10_000); })]); }
    finally { clearTimeout(assetTimer); }
    if (signal?.aborted) throw new Error("pdf_timeout");
    const rect = clone.getBoundingClientRect();
    const blocks = Array.from(clone.querySelectorAll("[data-pdf-block], img")).map(node => {
      const block = node.getBoundingClientRect();
      return { top: block.top - rect.top, bottom: block.bottom - rect.top };
    });
    // Text ranges expose individual lines, including within very tall notes/rows.
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      // Leave a small ascent margin for html2canvas's font rasterization.
      for (const line of Array.from(range.getClientRects())) blocks.push({ top: line.top - rect.top - 2, bottom: line.bottom - rect.top });
    }
    // Keep a small glyph-descent margin; the rest of the container's padding is not a page.
    const height = Math.ceil(Math.min(rect.height, blocks.length ? Math.max(...blocks.map(block => block.bottom)) + 12 : rect.height));
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const widthMm = pdf.internal.pageSize.getWidth() - 20;
    const heightMm = pdf.internal.pageSize.getHeight() - 20;
    const pixelsPerPage = Math.floor(heightMm * rect.width / widthMm);
    let top = 0;
    let index = 0;
    while (top < height) {
      if (signal?.aborted) throw new Error("pdf_timeout");
      const page = paginateQuote(height - top, pixelsPerPage, blocks.map(block => ({ top: block.top - top, bottom: block.bottom - top })))[0];
      const canvas = await html2canvas(clone, {
        scale: 1.5, useCORS: true, backgroundColor: "#ffffff", logging: false, imageTimeout: 10_000,
        width: rect.width, height: page.height, y: top,
        windowWidth: 794, scrollX: 0, scrollY: 0,
      });
      if (!canvas.width || !canvas.height) throw new Error("pdf_capture_failed");
      let output = canvas;
      if (top + page.height < height && blocks.some(block => block.bottom - block.top > pixelsPerPage && block.top < top + page.height && block.bottom > top + page.height)) {
        page.height = findQuotePageCut(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height), 1.5);
        output = document.createElement("canvas");
        output.width = canvas.width;
        output.height = Math.floor(page.height * 1.5);
        output.getContext("2d").drawImage(canvas, 0, 0);
      }
      if (index) pdf.addPage();
      pdf.addImage(output.toDataURL("image/jpeg", 0.92), "JPEG", 10, 10, widthMm, page.height * widthMm / rect.width);
      output.width = 0;
      output.height = 0;
      canvas.width = 0;
      canvas.height = 0;
      top += page.height;
      if (++index > 100) throw new Error("pdf_too_many_pages");
    }
    return pdf;
  } finally { signal?.removeEventListener("abort", removeClone); clone.remove(); }
}
