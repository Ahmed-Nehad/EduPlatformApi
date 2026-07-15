import type { Response } from 'express'
import { db } from '../db/connection.ts'
import {
  walletTransactions,
  redemptionCodes,
  codeRedemptions,
  teachers,
} from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, desc, eq, sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const offsetFor = (page: number, limit: number) => (page - 1) * limit

/**
 * Returns the student's current per-teacher balance by reading the latest
 * `balance_after` for the given `(studentId, teacherId)` pair.
 */
async function getPerTeacherBalance(
  studentId: string,
  teacherId: string,
  tx: typeof db | any // Accepts either the db object or a transaction object
): Promise<number> {
  const [latest] = await tx
    .select({ balanceAfter: walletTransactions.balanceAfter })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.studentId, studentId),
        eq(walletTransactions.teacherId, teacherId)
      )
    )
    .orderBy(desc(walletTransactions.createdAt))
    .limit(1)

  return latest ? Number(latest.balanceAfter) : 0
}

// ---------------------------------------------------------------------------
// POST /wallet/redeem — redeem a teacher's code
// ---------------------------------------------------------------------------

export const redeemCode = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { code: codeString } = req.body
  const studentId = req.user!.id

  // 1. Look up the code with teacher info
  const [code] = await db
    .select({
      id: redemptionCodes.id,
      teacherId: redemptionCodes.teacherId,
      code: redemptionCodes.code,
      creditAmount: redemptionCodes.creditAmount,
      isActive: redemptionCodes.isActive,
      expiresAt: redemptionCodes.expiresAt,
      deletedAt: redemptionCodes.deletedAt,
      teacherName: teachers.name,
    })
    .from(redemptionCodes)
    .innerJoin(teachers, eq(teachers.id, redemptionCodes.teacherId))
    .where(eq(redemptionCodes.code, codeString))
    .limit(1)

  // 2. Pre-checks
  if (!code) {
    throw AppError.notFound('CODE_NOT_FOUND', 'Redemption code not found')
  }
  if (!code.isActive) {
    throw new AppError(410, 'CODE_INACTIVE', 'This code is no longer active')
  }
  if (code.deletedAt) {
    throw new AppError(410, 'CODE_DELETED', 'This code has been deleted')
  }
  if (code.expiresAt && code.expiresAt < new Date()) {
    throw new AppError(410, 'CODE_EXPIRED', 'This code has expired')
  }

  // 3. Atomic transaction
  const result = await db.transaction(async (tx) => {
    // 3a. Check for existing redemption (UNIQUE backstop)
    const [existing] = await tx
      .select({ id: codeRedemptions.id })
      .from(codeRedemptions)
      .where(eq(codeRedemptions.codeId, code.id))
      .limit(1)

    if (existing) {
      throw AppError.conflict(
        'CODE_ALREADY_REDEEMED',
        'This code has already been redeemed'
      )
    }

    // 3b. Read current per-teacher balance - now uses tx
    const currentBalance = await getPerTeacherBalance(studentId, code.teacherId, tx)

    // 3c. Compute new balance
    const creditAmount = Number(code.creditAmount)
    const balanceAfter = currentBalance + creditAmount

    // 3d. Insert wallet transaction
    const [walletTx] = await tx
      .insert(walletTransactions)
      .values({
        studentId,
        teacherId: code.teacherId,
        type: 'credit_code',
        amount: creditAmount.toString(),
        balanceAfter: balanceAfter.toString(),
        referenceTable: 'redemption_codes',
        referenceId: code.id,
        description: `Redeemed code: ${code.code}`,
      })
      .returning()

    // 3e. Insert redemption record
    const [redemption] = await tx
      .insert(codeRedemptions)
      .values({
        codeId: code.id,
        studentId,
        walletTransactionId: walletTx.id,
      })
      .returning()

    return { walletTx, redemption, balanceAfter }
  })

  res.status(200).json({
    success: true,
    data: {
      balance_after: result.balanceAfter.toFixed(2),
      credit_amount: Number(code.creditAmount).toFixed(2),
      teacher_id: code.teacherId,
      teacher_name: code.teacherName,
      code: code.code,
    },
  })
}

// ---------------------------------------------------------------------------
// GET /wallet/balance — per-teacher balances
// ---------------------------------------------------------------------------

export const getBalance = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const studentId = req.user!.id

  const rows = await db
    .selectDistinctOn([walletTransactions.teacherId], {
      teacherId: walletTransactions.teacherId,
      balanceAfter: walletTransactions.balanceAfter,
      createdAt: walletTransactions.createdAt,
      teacherName: teachers.name,
    })
    .from(walletTransactions)
    .innerJoin(teachers, eq(teachers.id, walletTransactions.teacherId))
    .where(eq(walletTransactions.studentId, studentId))
    .orderBy(
      walletTransactions.teacherId,
      desc(walletTransactions.createdAt)
    )

  res.status(200).json({
    success: true,
    data: {
      balances: rows.map((r) => ({
        teacherId: r.teacherId,
        teacherName: r.teacherName,
        balance: Number(r.balanceAfter).toFixed(2),
      })),
    },
  })
}

// ---------------------------------------------------------------------------
// GET /wallet/transactions — paginated ledger
// ---------------------------------------------------------------------------

export const listTransactions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { page, limit } = req.query as unknown as {
    page: number
    limit: number
  }
  const offset = offsetFor(page, limit)
  const studentId = req.user!.id

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: walletTransactions.id,
        type: walletTransactions.type,
        amount: walletTransactions.amount,
        balanceAfter: walletTransactions.balanceAfter,
        description: walletTransactions.description,
        referenceTable: walletTransactions.referenceTable,
        referenceId: walletTransactions.referenceId,
        createdAt: walletTransactions.createdAt,
        teacherId: walletTransactions.teacherId,
        teacherName: teachers.name,
      })
      .from(walletTransactions)
      .innerJoin(teachers, eq(teachers.id, walletTransactions.teacherId))
      .where(eq(walletTransactions.studentId, studentId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(walletTransactions)
      .where(eq(walletTransactions.studentId, studentId)),
  ])

  res.status(200).json({
    success: true,
    data: {
      transactions: rows.map((r) => ({
        ...r,
        amount: Number(r.amount).toFixed(2),
        balanceAfter: Number(r.balanceAfter).toFixed(2),
      })),
    },
    meta: {
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit),
    },
  })
}
