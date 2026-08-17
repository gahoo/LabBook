import { OperationRejectError } from '../../lib/errors.js';
import { Router } from 'express';
import { applyWhitelist, listApplications, approveApplication, rejectApplication } from './service.js';

export const whitelistRouter = Router();

whitelistRouter.post('/apply', (req, res, next) => {
  try {
    applyWhitelist(req.body);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof OperationRejectError) {
      res.status((err as any).statusCode || 400).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Internal Server Error' });
    }

  }
});

export const whitelistAdminRouter = Router();

whitelistAdminRouter.get('/applications', (req, res, next) => {
  try {
    const apps = listApplications(req.query.status as string);
    res.json(apps);
  } catch (err) {
    if (err instanceof OperationRejectError) {
      res.status((err as any).statusCode || 400).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Internal Server Error' });
    }

  }
});

whitelistAdminRouter.post('/applications/:id/approve', (req, res, next) => {
  try {
    approveApplication(req.params.id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof OperationRejectError) {
      res.status((err as any).statusCode || 400).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Internal Server Error' });
    }

  }
});

whitelistAdminRouter.post('/applications/:id/reject', (req, res, next) => {
  try {
    rejectApplication(req.params.id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof OperationRejectError) {
      res.status((err as any).statusCode || 400).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Internal Server Error' });
    }

  }
});
