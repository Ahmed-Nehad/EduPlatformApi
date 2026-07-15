import { z } from 'zod'

const lectureIdParam = z.object({ id: z.uuid('Invalid lecture id') })
const teacherIdParam = z.object({ id: z.uuid('Invalid teacher id') })

// POST /student/lectures/:id/purchase
export const purchaseLectureSchema = z.object({
  params: lectureIdParam,
})

// GET /student/purchases — paginated
export const listPurchasesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
})

// GET /teachers — public, paginated
export const listTeachersCatalogSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
})

// GET /teachers/:id/lectures — public, paginated
export const listTeacherLecturesSchema = z.object({
  params: teacherIdParam,
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
})
