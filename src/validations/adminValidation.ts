import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------
const emailField = z.email('Invalid email address').max(120)
const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
const nameField = z.string().min(2, 'Name must be at least 2 characters').max(120)
const bioField = z.string().max(2000, 'Bio must be at most 2000 characters').optional()

// Pagination query params shared by the list endpoints.
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

// ---------------------------------------------------------------------------
// POST /admin/teachers  (create teacher account)
// ---------------------------------------------------------------------------
export const createTeacherSchema = z.object({
  body: z.object({
    name: nameField,
    email: emailField,
    password: passwordField,
    bio: bioField,
  }),
})

// ---------------------------------------------------------------------------
// GET /admin/teachers  (list all teachers)
// ---------------------------------------------------------------------------
export const listTeachersSchema = z.object({
  query: paginationQuerySchema,
})

// ---------------------------------------------------------------------------
// GET /admin/students  (list all students)
// ---------------------------------------------------------------------------
export const listStudentsSchema = z.object({
  query: paginationQuerySchema,
})

// ---------------------------------------------------------------------------
// DELETE /admin/devices/:id  (force-revoke a student device)
// ---------------------------------------------------------------------------
export const deviceIdParamSchema = z.object({
  params: z.object({
    id: z.uuid('Invalid device id'),
  }),
})

// ---------------------------------------------------------------------------
// GET /admin/students/:id/devices  (list all devices linked to a student)
// ---------------------------------------------------------------------------
export const studentIdParamSchema = z.object({
  params: z.object({
    id: z.uuid('Invalid student id'),
  }),
})

// ---------------------------------------------------------------------------
// PATCH /admin/teachers/:id  (update a teacher account)
// ---------------------------------------------------------------------------
// All fields are optional; at least one must be provided. The check lives on
// the body object itself (via superRefine) so it runs when `validate()` calls
// `shape.body.parse(req.body)`.
export const updateTeacherSchema = z.object({
  params: z.object({
    id: z.uuid('Invalid teacher id'),
  }),
  body: z
    .object({
      name: nameField.optional(),
      email: emailField.optional(),
      bio: bioField,
      avatarR2Key: z
        .string()
        .max(512, 'avatar_r2_key must be at most 512 characters')
        .optional(),
      isActive: z.boolean().optional(),
    })
    .superRefine((body, ctx) => {
      if (Object.keys(body).length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'At least one field must be provided to update',
          path: [],
        })
      }
    }),
})

// ---------------------------------------------------------------------------
// PATCH /admin/students/:id  (update a student account)
// ---------------------------------------------------------------------------
// All fields are optional; at least one must be provided (enforced on the body
// object itself so it runs during `shape.body.parse(req.body)`).
export const updateStudentSchema = z.object({
  params: z.object({
    id: z.uuid('Invalid student id'),
  }),
  body: z
    .object({
      name: nameField.optional(),
      email: emailField.optional(),
      isActive: z.boolean().optional(),
    })
    .superRefine((body, ctx) => {
      if (Object.keys(body).length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'At least one field must be provided to update',
          path: [],
        })
      }
    }),
})
