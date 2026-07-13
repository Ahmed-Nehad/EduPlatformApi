import type { NextFunction, Request, Response } from 'express'
import env, { isProd } from '../../env.ts'
import { AppError } from '../utils/AppError.ts'

export interface CustomError extends Error {
    status?: number
    code?: string
    details?: unknown
}

export const errorHandler = (
    err: CustomError,
    _req: Request,
    res: Response,
    // Express requires the error handler to be registered with arity 4 to be
    // recognized as such; the final `next` param is intentionally unused.
    _next: unknown
) => {
    // Stack traces are noisy in production and may leak internals; only log
    // them in non-production stages.
    if (!isProd()) {
        console.error(err.stack)
    }

    // Default error
    let status = err.status || 500
    let message = err.message || 'Internal Server Error'
    let code = err.code || 'INTERNAL_ERROR'
    let details: unknown | undefined = err.details

    // Handle specific error types
    if (err.name === 'ValidationError') {
        status = 400
        code = 'VALIDATION_ERROR'
        message = 'Validation Error'
    }

    if (err.name === 'UnauthorizedError') {
        status = 401
        code = 'UNAUTHORIZED'
        message = 'Unauthorized'
    }

    // AppError already carries a structured code/message/details.
    const isAppError = err instanceof AppError


    if (isAppError) {
        res.status(status).json({
            success: false,
            error: {
                code: err.code,
                message: err.message,
                details: err.details,
                ...(env.APP_STAGE === 'dev' && {
                    stack: err.stack,
                }),
            },
        })
    } else {
        res.status(status).json({
            success: false,
            error: {
                code,
                message,
                ...(details ? { details } : {}),
            },
            ...(env.APP_STAGE === 'dev' && {
                stack: err.stack,
            }),
        })
    }
}

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new Error(`Not found - ${req.originalUrl}`) as CustomError
  error.status = 404
  error.code = 'NOT_FOUND'
  next(error)
}
