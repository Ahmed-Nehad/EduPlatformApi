import { z } from 'zod'

// ---------------------------------------------------------------------------
// Public lecture catalog validation
// ---------------------------------------------------------------------------
// The catalog endpoints (`GET /lectures`, `GET /lectures/:id`) are open to any
// caller — no session is required. These schemas only validate the path /
// query params; there is no body to validate.

// ---------------------------------------------------------------------------
// GET /lectures  (browse published lectures)
// ---------------------------------------------------------------------------
// `teacher_id` is an optional filter to scope the catalog to a single teacher.
// Pagination mirrors the admin/teacher list schemas for consistency.
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export const listLecturesCatalogSchema = z.object({
  query: paginationQuerySchema.extend({
    teacher_id: z.uuid('Invalid teacher id').optional(),
  }),
})

// ---------------------------------------------------------------------------
// GET /lectures/:id  (lecture detail + content list)
// ---------------------------------------------------------------------------
export const getLectureDetailSchema = z.object({
  params: z.object({
    id: z.uuid('Invalid lecture id'),
  }),
})
