import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import { isTest } from '../env.ts'
import { errorHandler, notFound } from './middleware/errorHandler.ts'
import { apiRateLimiter } from './middleware/rateLimiter.ts'
import { env } from '../env.ts'
import routes from './routes/index.ts'

const app = express();

app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));
app.use(helmet());
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser(env.SESSION_COOKIE_SECRET))
app.use(
  morgan('dev', {
    skip: () => isTest(),
  })
)

// Global rate limiter (Redis-backed). Skipped in the test stage so the
// suite can exercise endpoints without being throttled.
app.use(apiRateLimiter)

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'Educational Platform API'
    })
})

// API routes (versioning managed in routes/index.ts)
app.use('/', routes)

// 404 handler - MUST come after all valid routes
app.use(notFound)

// Global error handler - MUST be last
app.use(errorHandler)

export default app;
