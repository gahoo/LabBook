import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { adminAuth } from '../../middleware/auth.js';
import { format } from 'date-fns';
import * as service from './service.js';

export const equipmentRouter = Router();
export const equipmentAdminRouter = Router();

// ========================
// Public / User Routes
// ========================

// 1. Get all equipment
equipmentRouter.get('/api/equipment', (req: Request, res: Response) => {
  let isAdmin = false;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as any;
      if (decoded && decoded.role === 'admin') {
        isAdmin = true;
      }
    } catch (e) {}
  }
  
  const equipment = service.getAllEquipment(isAdmin);
  res.json(equipment);
});

// 2. Get today's availability for all equipment
equipmentRouter.get('/api/equipment/availability/today', (req: Request, res: Response) => {
  const date = (req.query.date as string) || format(new Date(), 'yyyy-MM-dd');
  const results = service.getEquipmentAvailabilityToday(date);
  res.json(results);
});

// 3. Get availability for an equipment on a specific date or date range
equipmentRouter.get('/api/equipment/:id/availability', (req: Request, res: Response) => {
  const { id } = req.params;
  const { date, start_date, end_date } = req.query as any;
  
  const isRange = !!(start_date && end_date);

  if (!date && !isRange) {
    return res.status(400).json({ error: '需要提供 date 或 start_date & end_date' });
  }

  const result = service.getEquipmentAvailability(id, isRange, { date, start_date, end_date });
  if (!result) {
    return res.status(404).json({ error: '未找到该仪器' });
  }

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  if (result.isRange) {
    return res.json(result.results);
  } else {
    return res.json({ 
      availableSlots: result.results[0].availableSlots, 
      reservations: result.results[0].reservations, 
      maxDurationMinutes: result.results[0].maxDurationMinutes,
      minDurationMinutes: result.results[0].minDurationMinutes,
      message: (result.results[0] as any).message
    });
  }
});

// 4. Get all reservations for an equipment in a date range (for chart)
equipmentRouter.get('/api/equipment/:id/reservations', (req: Request, res: Response) => {
  const { id } = req.params;
  const { start, end } = req.query;
  
  const reservations = service.getEquipmentReservations(id, start as string, end as string);
  res.json(reservations);
});


// ========================
// Admin Routes
// ========================

equipmentAdminRouter.post('/api/admin/equipment', adminAuth, (req: Request, res: Response) => {
  try {
    const id = service.createEquipment(req.body);
    res.json({ id });
  } catch (error) {
    console.error('Create equipment error:', error);
    res.status(500).json({ error: 'Failed to create equipment' });
  }
});

equipmentAdminRouter.put('/api/admin/equipment/:id', adminAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    service.updateEquipment(id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Update equipment error:', error);
    res.status(500).json({ error: 'Failed to update equipment' });
  }
});

equipmentAdminRouter.put('/api/admin/equipment-batch', adminAuth, (req: Request, res: Response) => {
  const { ids, updates } = req.body;
  
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No equipment IDs provided' });
  }

  try {
    service.batchUpdateEquipment(ids, updates);
    res.json({ success: true });
  } catch (error) {
    console.error('Batch update error:', error);
    res.status(500).json({ error: 'Failed to batch update equipment' });
  }
});

equipmentAdminRouter.delete('/api/admin/equipment/:id', adminAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    service.deleteEquipment(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete equipment error:', error);
    res.status(500).json({ error: 'Failed to delete equipment' });
  }
});

