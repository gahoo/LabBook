import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { mailLimiter } from '../../middleware/rateLimiter.js';
import * as calendarService from './service.js';
import { OperationRejectError } from '../../lib/errors.js';

export const calendarRoutes = Router();

calendarRoutes.get('/api/calendar/user/url', (req, res) => {
  try {
    const url = calendarService.generateUserCalendarUrl(
      req.query.booking_code as string,
      (req.query.protocol as string) || 'webcal',
      req.get('host') || ''
    );
    res.json({ url });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to generate calendar URL' });
    }
  }
});

calendarRoutes.post('/api/calendar/user/mail', mailLimiter, (req, res) => {
  try {
    const email = calendarService.processUserCalendarMail(
      req.body.booking_code,
      req.get('host') || ''
    );
    res.json({ success: true, email });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to send calendar email' });
    }
  }
});

calendarRoutes.get('/api/calendar/user/:token.ics', (req, res) => {
  try {
    const icsContent = calendarService.getUserICS(req.params.token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my_reservations.ics"');
    res.send(icsContent);
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).send(error.message);
    } else {
      res.status(500).send('Internal Server Error');
    }
  }
});

calendarRoutes.get('/api/calendar/equipment/:token.ics', (req, res) => {
  try {
    const { icsContent, equipmentId } = calendarService.getEquipmentICS(req.params.token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="equip_${equipmentId}_reservations.ics"`);
    res.send(icsContent);
  } catch(error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).send(error.message);
    } else {
      res.status(500).send('Internal Server Error');
    }
  }
});

calendarRoutes.get('/api/calendar/equipment/:id/url', adminAuth, (req, res) => {
  try {
    const url = calendarService.generateEquipmentCalendarUrl(
      req.params.id,
      req.get('host') || ''
    );
    res.json({ url });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to generate calendar URL' });
    }
  }
});
