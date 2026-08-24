import { Router, Request, Response } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { getPublicSettings, getAllSettings, updateSettings } from './service.js';

const router = Router();

router.get('/api/settings', (req: Request, res: Response) => {
  try {
    const settingsMap = getPublicSettings();
    res.json(settingsMap);
  } catch (error) {
    console.error('Error fetching public settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/settings', adminAuth, (req: Request, res: Response) => {
  try {
    const settingsMap = getAllSettings();
    res.json(settingsMap);
  } catch (error) {
    console.error('Error fetching all settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/settings', adminAuth, (req: Request, res: Response) => {
  try {
    updateSettings(req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export { router as settingsRouter };
