import { z } from 'zod'

const codeIdParam = z.object({ id: z.uuid('Invalid code id') })

// POST /codes — generate a code
export const createCodeSchema = z.object({
  body: z.object({
    code: z.string().min(1).max(40),
    credit_amount: z.coerce.number().positive().max(100000),
    expires_at: z.iso.datetime().optional(),
  }),
})

// GET /codes — list my codes (active + soft-deleted)
export const listCodesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
})

// DELETE /codes/:id — soft delete
export const deleteCodeSchema = z.object({
  params: codeIdParam,
})
