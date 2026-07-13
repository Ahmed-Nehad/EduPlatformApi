import type { Response } from 'express'
import { eq, isNull, sql, desc, and, ne } from 'drizzle-orm'
import { db } from '../db/connection.ts'
import { teachers, students, studentDevices } from '../db/schema.ts'
import { hashPassword } from '../utils/password.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes the SQL offset for a page/limit pair (1-indexed pages).
 */
const offsetFor = (page: number, limit: number) => (page - 1) * limit

// ---------------------------------------------------------------------------
// POST /admin/teachers — create a teacher account
// ---------------------------------------------------------------------------

/**
 * Teachers cannot self-register; only an admin can create them. The acting
 * admin's id (from the session) is recorded on `created_by_admin_id`.
 */
export const createTeacher = async (req: AuthenticatedRequest, res: Response) => {
  const { name, email, password, bio } = req.body
  const adminId = req.user!.id

  // Pre-check for a clean 409; the DB unique constraint is the backstop.
  const [existing] = await db
    .select({ id: teachers.id })
    .from(teachers)
    .where(eq(teachers.email, email))
    .limit(1)

  if (existing) {
    throw AppError.conflict('EMAIL_TAKEN', 'A teacher with this email already exists')
  }

  const passwordHash = await hashPassword(password)
  const [created] = await db
    .insert(teachers)
    .values({
      name,
      email,
      passwordHash,
      bio: bio ?? null,
      createdByAdminId: adminId,
    })
    .returning({
      id: teachers.id,
      name: teachers.name,
      email: teachers.email,
      bio: teachers.bio,
      isActive: teachers.isActive,
      role: sql<'teacher'>`'teacher'`.as('role'),
      createdAt: teachers.createdAt,
    })

  res.status(201).json({
    success: true,
    data: { teacher: created },
  })
}

// ---------------------------------------------------------------------------
// GET /admin/teachers — list all teachers (paginated)
// ---------------------------------------------------------------------------

export const listTeachers = async (req: AuthenticatedRequest, res: Response) => {
  // `validate(listTeachersSchema)` has already parsed/coerced these values.
  const { page, limit } = req.query as unknown as { page: number; limit: number }
  const offset = offsetFor(page, limit)

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: teachers.id,
        name: teachers.name,
        email: teachers.email,
        bio: teachers.bio,
        isActive: teachers.isActive,
        role: sql<'teacher'>`'teacher'`.as('role'),
        createdAt: teachers.createdAt,
        updatedAt: teachers.updatedAt,
      })
      .from(teachers)
      .orderBy(desc(teachers.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(teachers),
  ])

  res.status(200).json({
    success: true,
    data: { teachers: rows },
    meta: {
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit),
    },
  })
}

// ---------------------------------------------------------------------------
// GET /admin/students — list all students (paginated)
// ---------------------------------------------------------------------------

export const listStudents = async (req: AuthenticatedRequest, res: Response) => {
  // `validate(listStudentsSchema)` has already parsed/coerced these values.
  const { page, limit } = req.query as unknown as { page: number; limit: number }
  const offset = offsetFor(page, limit)

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: students.id,
        name: students.name,
        email: students.email,
        isActive: students.isActive,
        emailVerifiedAt: students.emailVerifiedAt,
        role: sql<'student'>`'student'`.as('role'),
        createdAt: students.createdAt,
        updatedAt: students.updatedAt,
      })
      .from(students)
      .orderBy(desc(students.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(students),
  ])

  res.status(200).json({
    success: true,
    data: { students: rows },
    meta: {
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit),
    },
  })
}

// ---------------------------------------------------------------------------
// DELETE /admin/devices/:id — force-revoke a student device (frees the slot)
// ---------------------------------------------------------------------------

/**
 * Admins can force-revoke any student device to free up a slot, e.g. when a
 * student is locked out and cannot self-revoke. Revocation is a soft delete:
 * `revoked_at` is set so the device no longer counts against the 2-slot limit
 * but the audit row is preserved.
 */
export const revokeDevice = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params

  // Only active (non-revoked) devices are eligible; idempotent if already revoked.
  const [device] = await db
    .select({
      id: studentDevices.id,
      studentId: studentDevices.studentId,
      slotNumber: studentDevices.slotNumber,
      revokedAt: studentDevices.revokedAt,
    })
    .from(studentDevices)
    .where(eq(studentDevices.id, id))
    .limit(1)

  if (!device) {
    throw AppError.notFound('DEVICE_NOT_FOUND', 'No device found with that id')
  }

  if (device.revokedAt) {
    // Already revoked — nothing to do. Return the current state.
    return res.status(200).json({
      success: true,
      data: {
        device: {
          id: device.id,
          student_id: device.studentId,
          slot_number: device.slotNumber,
          revoked_at: device.revokedAt,
        },
        message: 'Device was already revoked',
      },
    })
  }

  const [updated] = await db
    .update(studentDevices)
    .set({
      revokedAt: new Date(),
      revokedReason: 'force-revoked by admin',
    })
    .where(eq(studentDevices.id, id))
    .returning({
      id: studentDevices.id,
      studentId: studentDevices.studentId,
      slotNumber: studentDevices.slotNumber,
      revokedAt: studentDevices.revokedAt,
      revokedReason: studentDevices.revokedReason,
    })

  res.status(200).json({
    success: true,
    data: {
      device: {
        id: updated.id,
        student_id: updated.studentId,
        slot_number: updated.slotNumber,
        revoked_at: updated.revokedAt,
        revoked_reason: updated.revokedReason,
      },
    },
  })
}

// ---------------------------------------------------------------------------
// GET /admin/students/:id/devices — list all devices linked to a student
// ---------------------------------------------------------------------------

/**
 * Returns every device row bound to a student, including revoked ones, so an
 * admin can audit device history and see which slots are currently occupied.
 * Ordered by slot number for a stable, predictable layout.
 */
export const listStudentDevices = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params

  // Verify the student exists; a non-existent student should 404 rather than
  // silently return an empty device list.
  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(eq(students.id, id))
    .limit(1)

  if (!student) {
    throw AppError.notFound('STUDENT_NOT_FOUND', 'No student found with that id')
  }

  const devices = await db
    .select({
      id: studentDevices.id,
      device_fingerprint: studentDevices.deviceFingerprint,
      device_label: studentDevices.deviceLabel,
      slot_number: studentDevices.slotNumber,
      bound_at: studentDevices.boundAt,
      last_seen_at: studentDevices.lastSeenAt,
      revoked_at: studentDevices.revokedAt,
      revoked_reason: studentDevices.revokedReason,
    })
    .from(studentDevices)
    .where(eq(studentDevices.studentId, id))
    .orderBy(studentDevices.slotNumber)

  res.status(200).json({
    success: true,
    data: {
      student_id: id,
      devices,
    },
  })
}

// ---------------------------------------------------------------------------
// PATCH /admin/teachers/:id — update a teacher account
// ---------------------------------------------------------------------------

/**
 * Partially updates a teacher. Only the supplied fields are written; the
 * schema guarantees at least one field is present. An email change is
 * pre-checked for a clean 409 (the DB unique constraint is the backstop).
 */
export const patchTeacher = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const { name, email, bio, avatarR2Key, isActive } = req.body

  // If the email is being changed, make sure it is not already in use by
  // another teacher so we can return a precise 409.
  if (email !== undefined) {
    const [existing] = await db
      .select({ id: teachers.id })
      .from(teachers)
      .where(and(eq(teachers.email, email), ne(teachers.id, id)))
      .limit(1)

    if (existing) {
      throw AppError.conflict('EMAIL_TAKEN', 'A teacher with this email already exists')
    }
  }

  const [updated] = await db
    .update(teachers)
    .set({
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(bio !== undefined && { bio }),
      ...(avatarR2Key !== undefined && { avatarR2Key }),
      ...(isActive !== undefined && { isActive }),
      updatedAt: new Date(),
    })
    .where(eq(teachers.id, id))
    .returning({
      id: teachers.id,
      name: teachers.name,
      email: teachers.email,
      bio: teachers.bio,
      avatarR2Key: teachers.avatarR2Key,
      isActive: teachers.isActive,
      role: sql<'teacher'>`'teacher'`.as('role'),
      createdAt: teachers.createdAt,
      updatedAt: teachers.updatedAt,
    })

  if (!updated) {
    throw AppError.notFound('TEACHER_NOT_FOUND', 'No teacher found with that id')
  }

  res.status(200).json({
    success: true,
    data: { teacher: updated },
  })
}

// ---------------------------------------------------------------------------
// PATCH /admin/students/:id — update a student account
// ---------------------------------------------------------------------------

/**
 * Partially updates a student. Only the supplied fields are written; the
 * schema guarantees at least one field is present. An email change is
 * pre-checked for a clean 409 (the DB unique constraint is the backstop).
 */
export const patchStudent = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const { name, email, isActive } = req.body

  // If the email is being changed, make sure it is not already in use by
  // another student so we can return a precise 409.
  if (email !== undefined) {
    const [existing] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.email, email), ne(students.id, id)))
      .limit(1)

    if (existing) {
      throw AppError.conflict('EMAIL_TAKEN', 'A student with this email already exists')
    }
  }

  const [updated] = await db
    .update(students)
    .set({
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(isActive !== undefined && { isActive }),
      updatedAt: new Date(),
    })
    .where(eq(students.id, id))
    .returning({
      id: students.id,
      name: students.name,
      email: students.email,
      isActive: students.isActive,
      emailVerifiedAt: students.emailVerifiedAt,
      role: sql<'student'>`'student'`.as('role'),
      createdAt: students.createdAt,
      updatedAt: students.updatedAt,
    })

  if (!updated) {
    throw AppError.notFound('STUDENT_NOT_FOUND', 'No student found with that id')
  }

  res.status(200).json({
    success: true,
    data: { student: updated },
  })
}
