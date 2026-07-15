import type { Response } from 'express'
import { db } from '../db/connection.ts'
import {
  lectures,
  walletTransactions,
  lecturePurchases,
  teacherAccessRequests,
  teachers,
} from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import {
  assertLectureAvailable,
  assertStudentAccessApproved,
} from '../utils/authorization.ts'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const offsetFor = (page: number, limit: number) => (page - 1) * limit

// ---------------------------------------------------------------------------
// POST /student/lectures/:id/purchase — buy a lecture
// ---------------------------------------------------------------------------

export const purchaseLecture = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id: lectureId } = req.params
  const studentId = req.user!.id

  // 1. Single JOIN query to load lecture + access + existing purchase
  const [row] = await db
    .select({
      // lecture fields
      lectureId: lectures.id,
      lectureTitle: lectures.title,
      lecturePrice: lectures.price,
      lectureStatus: lectures.status,
      lectureDeletedAt: lectures.deletedAt,
      lectureExpiresAt: lectures.expiresAt,
      lectureTeacherId: lectures.teacherId,
      // access request
      accessId: teacherAccessRequests.id,
      accessStatus: teacherAccessRequests.status,
      // existing purchase
      purchaseId: lecturePurchases.id,
    })
    .from(lectures)
    .leftJoin(
      teacherAccessRequests,
      and(
        eq(teacherAccessRequests.studentId, studentId),
        eq(teacherAccessRequests.teacherId, lectures.teacherId)
      )
    )
    .leftJoin(
      lecturePurchases,
      and(
        eq(lecturePurchases.studentId, studentId),
        eq(lecturePurchases.lectureId, lectures.id)
      )
    )
    .where(eq(lectures.id, lectureId))
    .limit(1)

  // 2. Assertions
  assertLectureAvailable(
    row
      ? {
          status: row.lectureStatus,
          deletedAt: row.lectureDeletedAt,
          expiresAt: row.lectureExpiresAt,
        }
      : null
  )

  assertStudentAccessApproved(
    row
      ? { status: row.accessStatus ?? ('pending' as const) }
      : null
  )

  if (row?.purchaseId) {
    throw AppError.conflict(
      'LECTURE_ALREADY_PURCHASED',
      'You have already purchased this lecture'
    )
  }

  // 3. Read per-teacher balance
  const teacherId = row!.lectureTeacherId
  const [latestTx] = await db
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

  const currentBalance = latestTx ? Number(latestTx.balanceAfter) : 0
  const price = Number(row!.lecturePrice)

  if (currentBalance < price) {
    throw new AppError(
      402,
      'INSUFFICIENT_BALANCE',
      `Insufficient balance with this teacher. Required: ${price.toFixed(2)}, available: ${currentBalance.toFixed(2)}`
    )
  }

  // 4. Atomic transaction
  const result = await db.transaction(async (tx) => {
    const balanceAfter = currentBalance - price

    // 4a. Insert wallet transaction (debit)
    const [walletTx] = await tx
      .insert(walletTransactions)
      .values({
        studentId,
        teacherId,
        type: 'debit_purchase',
        amount: price.toString(),
        balanceAfter: balanceAfter.toString(),
        referenceTable: 'lectures',
        referenceId: row!.lectureId,
        description: `Purchased: ${row!.lectureTitle}`,
      })
      .returning()

    // 4b. Insert purchase record
    const [purchase] = await tx
      .insert(lecturePurchases)
      .values({
        studentId,
        lectureId: row!.lectureId,
        walletTransactionId: walletTx.id,
      })
      .returning()

    return { purchase, balanceAfter }
  })

  res.status(200).json({
    success: true,
    data: {
      purchase: {
        id: result.purchase.id,
        lectureId: result.purchase.lectureId,
        purchasedAt: result.purchase.purchasedAt,
      },
      balance_after: result.balanceAfter.toFixed(2),
    },
  })
}

// ---------------------------------------------------------------------------
// GET /student/purchases — list my purchases
// ---------------------------------------------------------------------------

export const listPurchases = async (
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
        id: lecturePurchases.id,
        lectureId: lecturePurchases.lectureId,
        purchasedAt: lecturePurchases.purchasedAt,
        lectureTitle: lectures.title,
        lecturePrice: lectures.price,
        teacherId: lectures.teacherId,
        teacherName: teachers.name,
      })
      .from(lecturePurchases)
      .innerJoin(lectures, eq(lectures.id, lecturePurchases.lectureId))
      .innerJoin(teachers, eq(teachers.id, lectures.teacherId))
      .where(eq(lecturePurchases.studentId, studentId))
      .orderBy(desc(lecturePurchases.purchasedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(lecturePurchases)
      .where(eq(lecturePurchases.studentId, studentId)),
  ])

  res.status(200).json({
    success: true,
    data: {
      purchases: rows.map((r) => ({
        id: r.id,
        lectureId: r.lectureId,
        purchasedAt: r.purchasedAt,
        lectureTitle: r.lectureTitle,
        lecturePrice: Number(r.lecturePrice).toFixed(2),
        teacherId: r.teacherId,
        teacherName: r.teacherName,
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
