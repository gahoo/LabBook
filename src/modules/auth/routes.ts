import { Router, Request, Response } from 'express';
import { authLimiter } from '../../middleware/rateLimiter.js';
import { loginAdmin } from './service.js';

const router = Router();

router.post('/login', authLimiter, (req: Request, res: Response) => {
  const { password } = req.body;
  const token = loginAdmin(password);
  
  if (token) {
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: '密码错误' });
  }
});

export { router as authRouter };
