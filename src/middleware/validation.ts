import type { Request, Response, NextFunction } from 'express'
import { ZodType, ZodError, ZodObject } from 'zod'

// Validate request body
export const validateBody = (schema: ZodType<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Parse and validate request body
      const validatedData = schema.parse(req.body)
      
      // Replace req.body with validated data
      req.body = validatedData
      
      next() // Validation passed, continue
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.issues.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        })
      }
      next(error) // Unexpected error, pass to error handler
    }
  }
}

// Validate URL parameters
export const validateParams = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.params)
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Invalid parameters',
          details: error.issues.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        })
      }
      next(error)
    }
  }
}

// Validate query parameters
export const validateQuery = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.query)
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: error.issues.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        })
      }
      next(error)
    }
  }
}

/**
 * Combined validator for a wrapped schema of the form:
 *   z.object({ body: ..., params: ..., query: ... })
 * Each section is optional; only the provided ones are validated.
 */
type WrappedSchema = ZodObject<{
  body?: ZodType<any>
  params?: ZodType<any>
  query?: ZodType<any>
}>

export const validate = (schema: WrappedSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const shape = schema.shape
      if (shape.body) req.body = shape.body.parse(req.body)
      if (shape.params) {
        const parsed = shape.params.parse(req.params)
        req.params = parsed as Record<string, string>
      }
      if (shape.query) {
        const parsed = shape.query.parse(req.query)
        // Express 5 defines `req.query` as a getter-only property, so a direct
        // assignment throws. Redefine it as a writable own property instead.
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
        })
      }
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: error.issues.map((err) => ({
              field: err.path.join('.'),
              message: err.message,
            })),
          },
        })
      }
      next(error)
    }
  }
}