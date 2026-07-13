import { db } from '../../src/db/connection.ts'
import { students, teachers, admins, teacherAccessRequests } from '../../src/db/schema.ts'
import { hashPassword } from '../../src/utils/password.ts'

export interface TestUser {
  id: string
  name: string
  email: string
  role: 'student' | 'teacher' | 'admin'
  password: string
}

let counter = 0
/** Unique email per call to avoid collisions across tests. */
const uniqueEmail = (prefix: string) =>
  `${prefix}+${Date.now()}_${counter++}@test.edu`

export async function createStudent(
  overrides: Partial<{
    name: string
    email: string
    password: string
    isActive: boolean
    emailVerified: boolean
  }> = {}
): Promise<TestUser> {
  const password = overrides.password ?? 'Password123!'
  const passwordHash = await hashPassword(password)
  const email = overrides.email ?? uniqueEmail('student')
  const [row] = await db
    .insert(students)
    .values({
      name: overrides.name ?? 'Test Student',
      email,
      passwordHash,
      isActive: overrides.isActive ?? true,
      // Students are verified by default so existing login tests keep passing.
      // Tests that exercise the verification gate pass `emailVerified: false`.
      emailVerifiedAt:
        (overrides.emailVerified ?? true) ? new Date() : null,
    })
    .returning({ id: students.id, name: students.name, email: students.email })

  return { ...row, role: 'student', password }
}

export async function createTeacher(
  adminId: string,
  overrides: Partial<{ name: string; email: string; password: string; isActive: boolean }> = {}
): Promise<TestUser> {
  const password = overrides.password ?? 'Password123!'
  const passwordHash = await hashPassword(password)
  const email = overrides.email ?? uniqueEmail('teacher')
  const [row] = await db
    .insert(teachers)
    .values({
      name: overrides.name ?? 'Test Teacher',
      email,
      passwordHash,
      isActive: overrides.isActive ?? true,
      createdByAdminId: adminId,
    })
    .returning({ id: teachers.id, name: teachers.name, email: teachers.email })

  return { ...row, role: 'teacher', password }
}

export async function createAdmin(
  overrides: Partial<{ name: string; email: string; password: string }> = {}
): Promise<TestUser> {
  const password = overrides.password ?? 'Password123!'
  const passwordHash = await hashPassword(password)
  const email = overrides.email ?? uniqueEmail('admin')
  const [row] = await db
    .insert(admins)
    .values({
      name: overrides.name ?? 'Test Admin',
      email,
      passwordHash,
    })
    .returning({ id: admins.id, name: admins.name, email: admins.email })

  return { ...row, role: 'admin', password }
}

/** A valid device fingerprint string in the `sha256:<hex>` format. */
export const fingerprint = (seed: string) =>
  `sha256:${seed.padEnd(8, '0').slice(0, 64)}`


/**
 * Creates a teacher access request row in the database (for test purposes).
 * Returns the inserted row.
 */
export async function createTeacherAccessRequest(
  args: {
    studentId: string
    teacherId: string
    status?: 'pending' | 'approved' | 'rejected'
    requestedAt?: Date
    decidedAt?: Date | null
  }
) {
  const result = await db
    .insert(teacherAccessRequests)
    .values({
      studentId: args.studentId,
      teacherId: args.teacherId,
      status: args.status ?? 'pending',
      requestedAt: args.requestedAt ?? new Date(),
      decidedAt: args.decidedAt ?? null,
    })
    .returning()
  return result[0]
}