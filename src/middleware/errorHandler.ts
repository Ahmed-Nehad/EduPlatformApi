import type { Request, Response, NextFunction } from 'express'
import env from '../../env.ts'
import { AppError } from '../utils/AppError.ts'

export interface CustomError extends Error {
    status?: number
    code?: string
    details?: unknown
}

export const errorHandler = (
    err: CustomError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.error(err.stack)

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
