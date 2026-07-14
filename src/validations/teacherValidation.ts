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

// ===========================================================================
// LECTURES & CONTENT ORDERING
// ===========================================================================

// Shared lecture id param used by every lecture-scoped route.
const lectureIdParam = z.object({
  id: z.uuid('Invalid lecture id'),
})

// ---------------------------------------------------------------------------
// POST /teacher/lectures  (create — always starts as draft)
// ---------------------------------------------------------------------------
export const createLectureSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'title is required').max(200),
    description: z.string().max(5000).optional(),
    price: z.coerce.number().min(0, 'price must be >= 0'),
    thumbnailR2Key: z.string().max(512).optional(),
  }),
})

// ---------------------------------------------------------------------------
// PATCH /teacher/lectures/:id  (partial update)
// ---------------------------------------------------------------------------
// The "at least one field" check lives on the *body* schema (not the outer
// wrapper) because the `validate` middleware parses each section individually
// via `shape.body.parse()`. A refine on the outer object would never run.
const updateLectureBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    price: z.coerce.number().min(0).optional(),
    thumbnailR2Key: z.string().max(512).nullable().optional(),
    status: z.enum(['draft', 'published']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update',
    path: [],
  })

export const updateLectureSchema = z.object({
  params: lectureIdParam,
  body: updateLectureBody,
})

// ---------------------------------------------------------------------------
// DELETE /teacher/lectures/:id  (soft delete)
// ---------------------------------------------------------------------------
export const deleteLectureSchema = z.object({
  params: lectureIdParam,
})

// ---------------------------------------------------------------------------
// GET /teacher/lectures  (list my lectures, paginated)
// ---------------------------------------------------------------------------
export const listLecturesSchema = z.object({
  query: paginationQuerySchema.extend({
    status: z.enum(['draft', 'published']).optional(),
  }),
})

// ---------------------------------------------------------------------------
// GET /teacher/lectures/:id  (single lecture detail with content items)
// ---------------------------------------------------------------------------
export const getTeacherLectureDetailSchema = z.object({
  params: lectureIdParam,
})

// ---------------------------------------------------------------------------
// POST /teacher/lectures/:id/content  (add a video/file/quiz item)
// ---------------------------------------------------------------------------
export const addContentItemSchema = z.object({
  params: lectureIdParam,
  body: z.object({
    content_type: z.enum(['video', 'file', 'quiz']),
    content_id: z.uuid('Invalid content id'),
    position: z.number().int().positive(),
  }),
})

// ---------------------------------------------------------------------------
// PATCH /teacher/lectures/:id/content  (bulk reorder)
// ---------------------------------------------------------------------------
export const reorderContentSchema = z.object({
  params: lectureIdParam,
  body: z.object({
    items: z
      .array(
        z.object({
          item_id: z.uuid('Invalid item id'),
          position: z.number().int().positive(),
        })
      )
      .min(1, 'At least one item is required'),
  }),
})

// ---------------------------------------------------------------------------
// DELETE /teacher/lectures/:id/content/:itemId  (remove an item)
// ---------------------------------------------------------------------------
export const removeContentItemSchema = z.object({
  params: z.object({
    id: z.uuid('Invalid lecture id'),
    itemId: z.uuid('Invalid item id'),
  }),
})