const _rawUrl = import.meta.env.VITE_REPORT_SERVER_URL || 'http://localhost:3000';
// Ensure the URL has a protocol — prevents it being treated as a relative path if env var is missing https://
const REPORT_SERVER_URL = _rawUrl.startsWith('http') ? _rawUrl : `https://${_rawUrl}`;
const REPORT_API_KEY = import.meta.env.VITE_REPORT_API_KEY || '';

export interface PdfReportRequest {
  company_id: string;
  company_name: string;
  market: string;
  p1_start: string; // YYYY-MM-DD
  p1_end: string;
  p2_start: string;
  p2_end: string;
}

export async function downloadPdfReport(params: PdfReportRequest): Promise<void> {
  const res = await fetch(`${REPORT_SERVER_URL}/generate-report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': REPORT_API_KEY,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorBody.error || `Report generation failed (${res.status})`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${params.company_name}_${params.market}_AI_Brief.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
