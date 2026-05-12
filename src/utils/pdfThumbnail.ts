// Generate a PNG thumbnail of page 1 of a PDF, fully in the browser.
// pdfjs-dist is dynamically imported so it only ships when an admin actually
// uploads a report.

export interface ThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
}

const TARGET_WIDTH = 800; // device-pixel width; cards display at ~300px so this scales nicely

export async function generatePdfThumbnail(file: File): Promise<ThumbnailResult> {
  const pdfjs = await import('pdfjs-dist');
  // Use the worker bundled by Vite. The `?url` query gives us a runtime URL.
  // @ts-expect-error virtual ?url import
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buf });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = TARGET_WIDTH / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');

    // White background so transparent PDFs still look right.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png', 0.9);
    });

    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    pdf.destroy();
  }
}
