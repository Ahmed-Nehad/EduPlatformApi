import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

// Pagination query params shared by the list endpoints. Mirrors the admin
// pagination schema so behavior is consistent across role surfaces.
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// The access-request statuses a teacher may filter / decide on. `pending` is
// the default filter for the access-requests list.
const accessRequestStatusField = z.enum(['pending', 'approved', 'rejected'])

export type AccessRequestStatus = z.infer<typeof accessRequestStatusField>


// ---------------------------------------------------------------------------
// POST /teacher/access-requests/:id  (approve / deny a student)
// ---------------------------------------------------------------------------
// The body carries the decision. Only `approved` or `rejected` are accepted —
// a teacher cannot set a request back to `pending`.
export const decideAccessRequestSchema = z.object({
  params: z.object({
    userId: z.uuid('Invalid user id'),
  }),
  body: z.object({
    status: z.enum(['approved', 'rejected'], {
      message: 'status must be either "approved" or "rejected"',
    }),
  }),
})

// ---------------------------------------------------------------------------
// GET /teacher/students  (my approved students)
// ---------------------------------------------------------------------------
export const listStudentsSchema = z.object({
  query: paginationQuerySchema.extend({
    status: accessRequestStatusField.default('approved'),
  }),
})