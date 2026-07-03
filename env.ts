import dotenv from 'dotenv'
import { z } from 'zod'

process.env.APP_STAGE ??= 'dev'

const isProduction = process.env.APP_STAGE === 'production'
const isDevelopment = process.env.APP_STAGE === 'dev'
const isTesting = process.env.APP_STAGE === 'test'

if (isDevelopment) {
  dotenv.config()
}

if (isTesting) {
  dotenv.config({ path: '.env.test' })
}

if (isProduction) {
  dotenv.config({ path: '.env.production' })
}

const envSchema = z.object({
  NODE_ENV: z
  .enum(['development', 'production', 'test'])
  .default('development'),
  
  APP_STAGE: z.enum(['dev', 'production', 'test']).default('dev'),
  
  PORT: z.coerce.number().positive().default(3000),
  HOST: z.string().default('localhost'),
  
  BCRYPT_ROUNDS: z.coerce.number().min(10).max(20).default(12),

  // Rate limiting (backed by Redis via ioredis)
  RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(15 * 60 * 1000), // 15 min
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().positive().default(100),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().positive().default(15 * 60 * 1000), // 15 min
  RATE_LIMIT_AUTH_MAX_REQUESTS: z.coerce.number().positive().default(10),

  RESEND_API_KEY: z.string().startsWith('re'),
  RESEND_EMAIL: z.email(),

  DATABASE_URL: z.string().startsWith('postgresql://'),
  DATABASE_POOL_MIN: z.coerce.number().min(0).default(2),
  DATABASE_POOL_MAX: z.coerce.number().positive().default(10),

  // Redis & sessions
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  SESSION_TTL_SECONDS: z.coerce.number().positive().default(60 * 60 * 24 * 7), // 7 days
  SESSION_COOKIE_NAME: z.string().default('sid'),
  SESSION_COOKIE_SECRET: z.string().min(16),

  // Password reset
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().positive().default(30),

  // Email verification
  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().positive().default(60 * 24), // 24h

  APP_BASE_URL: z.string().default('http://localhost:3000'),

  CORS_ORIGIN: z
  .string()
  .or(z.array(z.string()))
  .transform((val) => {
    if (typeof val === 'string') {
      return val.split(',').map((origin) => origin.trim())
    }
    return val
  }),
  // .default([]),


  LOG_LEVEL: z
  .enum(['error', 'warn', 'info', 'debug', 'trace'])
  .default(isProduction ? 'info' : 'debug'),
})

export type Env = z.infer<typeof envSchema>
let env: Env

try {
  env = envSchema.parse(process.env)
} catch (e) {
  if (e instanceof z.ZodError) {
    console.log('Invalid env var')
    // console.error(JSON.stringify(e.flatten().fieldErrors, null, 2))
    console.error(JSON.stringify(z.flattenError(e).fieldErrors, null, 2))

    e.issues.forEach((err) => {
      const path = err.path.join('.')
      console.log(`${path}: ${err.message}`)
    })

    process.exit(1)
  }

  throw e
}

export const isProd = () => env.APP_STAGE === 'production'
export const isDev = () => env.APP_STAGE === 'dev'
export const isTest = () => env.APP_STAGE === 'test'

export { env }
export default env
