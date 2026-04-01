import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);

export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const tmpDir = '/tmp';
  const id = uuidv4();
  const docxPath = path.join(tmpDir, `report-${id}.docx`);
  const pdfPath = path.join(tmpDir, `report-${id}.pdf`);

  try {
    // Write DOCX to temp file
    await fs.writeFile(docxPath, docxBuffer);

    // Convert via LibreOffice
    await execFileAsync('soffice', [
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', tmpDir,
      docxPath,
    ], { timeout: 30_000 });

    // Read resulting PDF
    const pdfBuffer = await fs.readFile(pdfPath);
    return pdfBuffer;
  } finally {
    // Clean up temp files
    await fs.unlink(docxPath).catch(() => {});
    await fs.unlink(pdfPath).catch(() => {});
  }
}
