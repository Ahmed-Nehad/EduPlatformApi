import type { Response } from 'express'
import { db } from '../db/connection.ts'
import { redemptionCodes } from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { desc, eq, isNull, sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const offsetFor = (page: number, limit: number) => (page - 1) * limit

// ---------------------------------------------------------------------------
// POST /codes — create a redemption code (teacher only)
// ---------------------------------------------------------------------------

export const createCode = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { code, credit_amount, expires_at } = req.body
  const teacherId = req.user!.id

  try {
    const [row] = await db
      .insert(redemptionCodes)
      .values({
        teacherId,
        code,
        creditAmount: credit_amount.toString(),
        isActive: true,
        ...(expires_at ? { expiresAt: new Date(expires_at) } : {}),
      })
      .returning()

    res.status(201).json({
      success: true,
      data: {
        code: {
          id: row.id,
          code: row.code,
          creditAmount: row.creditAmount,
          isActive: row.isActive,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        },
      },
    })
  } catch (err: unknown) {
    // Drizzle wraps the pg unique_violation (23505) — check cause or message.
    const pgCode =
      (err as { cause?: { code?: string } })?.cause?.code ??
      (err as { code?: string })?.code
    const msg = err instanceof Error ? err.message : ''
    if (
      pgCode === '23505' ||
      msg.includes('redemption_codes_code_unique')
    ) {
      throw AppError.conflict(
        'CODE_ALREADY_EXISTS',
        'A code with this string already exists'
      )
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// GET /codes — list my codes (newest first, includes soft-deleted)
// ---------------------------------------------------------------------------

export const listCodes = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { page, limit } = req.query as unknown as {
    page: number
    limit: number
  }
  const offset = offsetFor(page, limit)
  const teacherId = req.user!.id

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(redemptionCodes)
      .where(eq(redemptionCodes.teacherId, teacherId))
      .orderBy(desc(redemptionCodes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(redemptionCodes)
      .where(eq(redemptionCodes.teacherId, teacherId)),
  ])

  res.status(200).json({
    success: true,
    data: { codes: rows },
    meta: {
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit),
    },
  })
}

// ---------------------------------------------------------------------------
// DELETE /codes/:id — soft delete
// ---------------------------------------------------------------------------

export const deleteCode = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params
  const teacherId = req.user!.id

  const now = new Date()
  const [row] = await db
    .update(redemptionCodes)
    .set({ deletedAt: now })
    .where(
      sql`${redemptionCodes.id} = ${id} AND ${redemptionCodes.teacherId} = ${teacherId}`
    )
    .returning({ id: redemptionCodes.id, deletedAt: redemptionCodes.deletedAt })

  if (!row) {
    throw AppError.notFound('CODE_NOT_FOUND', 'Code not found')
  }

  res.status(200).json({
    success: true,
    data: { code: { id: row.id, deletedAt: row.deletedAt } },
  })
}
