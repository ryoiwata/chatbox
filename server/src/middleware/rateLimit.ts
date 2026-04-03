import { rateLimit } from 'express-rate-limit'

// Auth endpoints: 10 attempts per minute (prevents brute force)
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

// General API: 60 requests per minute
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})
