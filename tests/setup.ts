import { beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables for testing, or set defaults
dotenv.config({ path: '.env.test' });
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret';
}
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = 'admin';
}

process.env.NODE_ENV = 'test';

// Mock external services like nodemailer and fetch globally
vi.mock('nodemailer', () => {
  const createTransport = vi.fn().mockReturnValue({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
    verify: vi.fn().mockResolvedValue(true),
  });
  return {
    default: { createTransport },
    createTransport
  };
});

// Optionally mock global fetch if webhook features use it
const originalFetch = global.fetch;
global.fetch = vi.fn((input, init) => {
  if (typeof input === 'string' && input.includes('webhook')) {
    return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
  }
  // Let other requests pass through (or you can mock everything)
  throw new Error(`Unhandled external network request in test: ${input}`);
});

beforeAll(() => {
  // 抑制测试过程中的预期错误日志噪声
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Global setup before tests
});

afterAll(() => {
  // Global teardown after tests
  vi.restoreAllMocks();
});
vi.mock('express-rate-limit', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return (req: any, res: any, next: any) => next();
    }),
  };
});
