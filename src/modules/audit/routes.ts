import { Router, Request, Response } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { validateTimeRange } from '../../lib/validators.js';
import { getAuditLogs } from './service.js';

const router = Router();

router.get('/', adminAuth, (req: Request, res: Response) => {
  if (!validateTimeRange(req, res, 'start_date', 'end_date')) return;

  const { start_date, end_date } = req.query as { start_date?: string, end_date?: string };
  
  try {
    const logs = getAuditLogs(start_date, end_date);
    res.json(logs);
  } catch (error) {
    console.error('Failed to get audit logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as auditAdminRouter };
