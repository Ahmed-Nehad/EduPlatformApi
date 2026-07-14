import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

// Pagination query params shared by the list endpoints. Mirrors the admin and
// teacher pagination schemas so behavior is consistent across role surfaces.
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// ---------------------------------------------------------------------------
// GET /student/devices  (list my bound devices)
// ---------------------------------------------------------------------------
// No params, no body — the student id comes from the authenticated session.
export const listMyDevicesSchema = z.object({})

// ---------------------------------------------------------------------------
// POST /student/access-requests/:teacherId  (request access to a teacher)
// ---------------------------------------------------------------------------
// The teacher id is carried in the path. Using `:teacherId` (not `:id`) keeps
// the param name explicit about what it identifies.
export const createAccessRequestSchema = z.object({
  params: z.object({
    teacherId: z.uuid('Invalid teacher id'),
  }),
})

// ---------------------------------------------------------------------------
// GET /student/my-teachers  (teachers who approved me)
// ---------------------------------------------------------------------------
// Pagination only; the student id comes from the authenticated session.
export const listMyTeachersSchema = z.object({
  query: paginationQuerySchema,
})
