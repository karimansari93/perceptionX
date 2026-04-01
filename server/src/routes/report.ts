import { Router, Request, Response } from 'express';
import { isValidUUID, isValidPeriod } from '../utils/validators';
import { fetchReportData } from '../services/dataService';
import { generateDocx } from '../services/docxService';
import { convertDocxToPdf } from '../services/pdfService';
import { ReportRequest } from '../types';

export const reportRouter = Router();

reportRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { company_id, period1, period2, market } = req.body as ReportRequest;

    // Validate inputs
    if (!company_id || !isValidUUID(company_id)) {
      res.status(400).json({ error: 'Invalid or missing company_id (must be UUID)' });
      return;
    }
    if (!period1 || !isValidPeriod(period1)) {
      res.status(400).json({ error: 'Invalid or missing period1 (must be YYYY-MM)' });
      return;
    }
    if (!period2 || !isValidPeriod(period2)) {
      res.status(400).json({ error: 'Invalid or missing period2 (must be YYYY-MM)' });
      return;
    }
    if (!market || typeof market !== 'string') {
      res.status(400).json({ error: 'Invalid or missing market' });
      return;
    }

    // 1. Fetch and compute report data
    const reportData = await fetchReportData(company_id, period1, period2, market);

    // 2. Generate DOCX
    const docxBuffer = await generateDocx(reportData);

    // 3. Convert to PDF
    const pdfBuffer = await convertDocxToPdf(docxBuffer);

    // 4. Stream PDF response
    const filename = `${reportData.companyName.replace(/[^a-zA-Z0-9]/g, '_')}_Report_${period1}_vs_${period2}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('Report generation failed:', err);
    res.status(500).json({
      error: 'Report generation failed',
      details: err.message || 'Unknown error',
    });
  }
});
