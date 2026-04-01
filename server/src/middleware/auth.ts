import { Request, Response, NextFunction } from 'express';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.REPORT_API_KEY;

  if (!expectedKey) {
    res.status(500).json({ error: 'Server misconfigured: REPORT_API_KEY not set' });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing X-API-Key' });
    return;
  }

  next();
}
