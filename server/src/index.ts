import express from 'express';
import cors from 'cors';
import { apiKeyAuth } from './middleware/auth';
import { reportRouter } from './routes/report';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/generate-report', apiKeyAuth, reportRouter);

app.listen(PORT, () => {
  console.log(`Report server listening on port ${PORT}`);
});
