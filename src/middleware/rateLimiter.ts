import rateLimit, { ipKeyGenerator, type RateLimitExceededEventHandler } from 'express-rate-limit'
import { RedisStore, type RedisReply } from 'rate-limit-redis'
import type { Request, Response } from 'express'
import { env, isTest } from '../../env.ts'
import { redis } from '../db/redis.ts'

const createRedisStore = (prefix: string) =>
  new RedisStore({
    sendCommand: (...args: string[]) =>
      // Correctly spreading the arguments for ioredis
      redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
    prefix,
    resetExpiryOnChange: true,
  })

const rateLimitResponse = (code: string, message: string): RateLimitExceededEventHandler =>
  (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: { code, message },
    })
  }

export const apiRateLimiter = rateLimit({
  store: createRedisStore('rl:api:'),
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  passOnStoreError: true,
  skip: () => isTest(),
  handler: rateLimitResponse(
    'RATE_LIMIT_EXCEEDED',
    'Too many requests, please try again later.'
  ),
})

// IP-based limiter for Auth routes (prevents mass scanning from one IP)
export const authIpRateLimiter = rateLimit({
  store: createRedisStore('rl:auth:ip:'),
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  limit: env.RATE_LIMIT_AUTH_MAX_REQUESTS, 
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  passOnStoreError: false, // Fail closed for security
  skip: () => isTest(),
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip as string) ?? 'unknown',
  handler: rateLimitResponse(
    'AUTH_RATE_LIMIT_EXCEEDED',
    'Too many authentication attempts from this network, please try again later.'
  ),
})

export default apiRateLimiter