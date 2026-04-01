const REPORT_SERVER_URL = import.meta.env.VITE_REPORT_SERVER_URL || 'http://localhost:3001';
const REPORT_API_KEY = import.meta.env.VITE_REPORT_API_KEY || '';

export interface PdfReportRequest {
  company_id: string;
  period1: string; // YYYY-MM
  period2: string; // YYYY-MM
  market: string;
}

export async function downloadPdfReport(params: PdfReportRequest): Promise<void> {
  const res = await fetch(`${REPORT_SERVER_URL}/generate-report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': REPORT_API_KEY,
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
  a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
    || `report_${params.period1}_vs_${params.period2}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
