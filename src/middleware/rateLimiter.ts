import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 20, 
  message: { error: '登录请求过于频繁，请稍后再试' },
  standardHeaders: true, 
  legacyHeaders: false, 
});

export const mailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '发送邮件请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: '操作请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});
