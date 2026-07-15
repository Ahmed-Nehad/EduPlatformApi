import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  smallint,
  bigint,
  numeric,
  char,
  jsonb,
  pgEnum,
  customType,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { relations } from 'drizzle-orm'

// ---------------------------------------------------------------------
// ENUM TYPES
// ---------------------------------------------------------------------
export const accessRequestStatusEnum = pgEnum('access_request_status', [
  'pending',
  'approved',
  'rejected',
])

export const walletTxTypeEnum = pgEnum('wallet_tx_type', [
  'credit_code',
  'credit_payment',
  'debit_purchase',
  'refund',
  'adjustment',
])

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'success',
  'failed',
  'refunded',
])

export const lectureStatusEnum = pgEnum('lecture_status', ['draft', 'published'])

export const contentTypeEnum = pgEnum('content_type', ['video', 'file', 'quiz'])

export const questionTypeEnum = pgEnum('question_type', [
  'mcq',
  'written',
  'true_false',
])

export const quizLockModeEnum = pgEnum('quiz_lock_mode', [
  'calendar',
  'after_submission',
])

export const attemptStatusEnum = pgEnum('attempt_status', [
  'in_progress',
  'submitted',
  'graded',
])

export const videoStatusEnum = pgEnum('video_status', [
  'processing',
  'ready',
  'failed',
  'expired',
])

// =====================================================================
// 1. IDENTITY & ACCESS
// =====================================================================

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 120 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const teachers = pgTable('teachers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 120 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  bio: text('bio'),
  avatarR2Key: text('avatar_r2_key'),
  isActive: boolean('is_active').default(true).notNull(),
  createdByAdminId: uuid('created_by_admin_id')
    .notNull()
    .references(() => admins.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const students = pgTable('students', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 120 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// Password reset via email
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('idx_pw_reset_student').on(t.studentId)]
)

// Email verification: single-use tokens issued at registration.
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('idx_email_verify_student').on(t.studentId)]
)

// Device binding: exactly 2 permanent slots per student.
export const studentDevices = pgTable(
  'student_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    deviceFingerprint: text('device_fingerprint').notNull(),
    deviceLabel: varchar('device_label', { length: 120 }),
    slotNumber: smallint('slot_number').notNull(),
    boundAt: timestamp('bound_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    unique('student_devices_student_id_slot_number_unique').on(
      t.studentId,
      t.slotNumber
    ),
    unique('student_devices_student_id_device_fingerprint_unique').on(
      t.studentId,
      t.deviceFingerprint
    ),
    check('student_devices_slot_number_check', sql`${t.slotNumber} in (1, 2)`),
    // Partial index: fast lookup of a student's currently-active (non-revoked) devices
    index('idx_devices_active')
      .on(t.studentId)
      .where(sql`revoked_at IS NULL`),
  ]
)

export const teacherAccessRequests = pgTable(
  'teacher_access_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    status: accessRequestStatusEnum('status').default('pending').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    unique('teacher_access_requests_student_id_teacher_id_unique').on(
      t.studentId,
      t.teacherId
    ),
    index('idx_access_req_teacher_status').on(t.teacherId, t.status),
  ]
)

// =====================================================================
// 2. WALLET, PAYMENTS & CODES  (ledger-based)
// =====================================================================

export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id),
    type: walletTxTypeEnum('type').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    balanceAfter: numeric('balance_after', {
      precision: 12,
      scale: 2,
    }).notNull(),
    referenceTable: varchar('reference_table', { length: 40 }),
    referenceId: uuid('reference_id'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_wallet_tx_student').on(t.studentId, t.teacherId, t.createdAt),
  ]
)

// Strictly single-use: consumption enforced by UNIQUE(code_id) on code_redemptions.
export const redemptionCodes = pgTable(
  'redemption_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id),
    code: varchar('code', { length: 40 }).notNull().unique(),
    creditAmount: numeric('credit_amount', { precision: 12, scale: 2 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('redemption_codes_credit_amount_check', sql`${t.creditAmount} > 0`),
    index('idx_codes_teacher_active')
      .on(t.teacherId)
      .where(sql`is_active AND deleted_at IS NULL`),
  ]
)

// Strictly single-use: one redemption per code via UNIQUE(code_id).
export const codeRedemptions = pgTable(
  'code_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeId: uuid('code_id')
      .notNull()
      .references(() => redemptionCodes.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    walletTransactionId: uuid('wallet_transaction_id')
      .notNull()
      .references(() => walletTransactions.id),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique('code_redemptions_code_id_unique').on(t.codeId)]
)

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    provider: varchar('provider', { length: 30 }).default('kashier').notNull(),
    providerReference: varchar('provider_reference', { length: 120 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).default('EGP').notNull(),
    status: paymentStatusEnum('status').default('pending').notNull(),
    rawPayload: jsonb('raw_payload'),
    walletTransactionId: uuid('wallet_transaction_id').references(
      () => walletTransactions.id
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique('payments_provider_provider_reference_unique').on(
      t.provider,
      t.providerReference
    ),
    index('idx_payments_student').on(t.studentId, t.createdAt),
  ]
)

// =====================================================================
// 3. LECTURES & CONTENT
// =====================================================================

export const lectures = pgTable(
  'lectures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    thumbnailR2Key: text('thumbnail_r2_key'),
    status: lectureStatusEnum('status').default('draft').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .default(sql`now() + interval '1 year'`)
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('lectures_price_check', sql`${t.price} >= 0`),
    index('idx_lectures_teacher')
      .on(t.teacherId)
      .where(sql`deleted_at IS NULL`),
    index('idx_lectures_expiry')
      .on(t.expiresAt)
      .where(sql`deleted_at IS NULL`),
  ]
)

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id, { onDelete: 'cascade' }),
    vdocipherVideoId: varchar('vdocipher_video_id', { length: 120 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    durationSeconds: integer('duration_seconds'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    status: videoStatusEnum('status').default('processing').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_videos_lecture')
      .on(t.lectureId)
      .where(sql`deleted_at IS NULL`),
  ]
)

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id, { onDelete: 'cascade' }),
    r2ObjectKey: text('r2_object_key').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_files_lecture')
      .on(t.lectureId)
      .where(sql`deleted_at IS NULL`),
  ]
)

// Polymorphic ordering table: lets a teacher interleave videos/files/quizzes
// in any order within a lecture without denormalizing order into three tables.
export const lectureContentItems = pgTable(
  'lecture_content_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id, { onDelete: 'cascade' }),
    contentType: contentTypeEnum('content_type').notNull(),
    contentId: uuid('content_id').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    unique('lecture_content_items_lecture_id_content_type_content_id_unique').on(
      t.lectureId,
      t.contentType,
      t.contentId
    ),
    unique('lecture_content_items_lecture_id_position_unique').on(
      t.lectureId,
      t.position
    ),
  ]
)

export const lecturePurchases = pgTable(
  'lecture_purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id),
    walletTransactionId: uuid('wallet_transaction_id')
      .notNull()
      .references(() => walletTransactions.id),
    purchasedAt: timestamp('purchased_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique('lecture_purchases_student_id_lecture_id_unique').on(
      t.studentId,
      t.lectureId
    ),
    index('idx_purchases_student').on(t.studentId),
  ]
)

// Analytics: "who viewed each lecture"
export const lectureViews = pgTable(
  'lecture_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id),
    contentType: contentTypeEnum('content_type').notNull(),
    contentId: uuid('content_id').notNull(),
    deviceId: uuid('device_id').references(() => studentDevices.id),
    watchSeconds: integer('watch_seconds'),
    viewedAt: timestamp('viewed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_views_lecture').on(t.lectureId, t.viewedAt),
    index('idx_views_student').on(t.studentId),
  ]
)

// =====================================================================
// 4. QUIZZES
// =====================================================================

export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    lockMode: quizLockModeEnum('lock_mode')
      .default('after_submission')
      .notNull(),
    lockUntil: timestamp('lock_until', { withTimezone: true }),
    allowMultipleAttempts: boolean('allow_multiple_attempts')
      .default(false)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      'chk_lock_until',
      sql`(${t.lockMode} = 'calendar' AND ${t.lockUntil} IS NOT NULL) OR (${t.lockMode} = 'after_submission')`
    ),
  ]
)

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    attemptNumber: integer('attempt_number').default(1).notNull(),
    status: attemptStatusEnum('status').default('in_progress').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    score: numeric('score', { precision: 6, scale: 2 }),
  },
  (t) => [
    unique('quiz_attempts_quiz_id_student_id_attempt_number_unique').on(
      t.quizId,
      t.studentId,
      t.attemptNumber
    ),
    index('idx_attempts_student').on(t.studentId),
    index('idx_attempts_quiz').on(t.quizId),
  ]
)

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    questionText: text('question_text').notNull(),
    questionType: questionTypeEnum('question_type').notNull(),
    options: jsonb('options'),
    correctOptionLabel: char('correct_option_label', { length: 1 }),
    points: numeric('points', { precision: 6, scale: 2 }).default('1').notNull(),
    imageR2Key: text('image_r2_key'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique('quiz_questions_quiz_id_position_unique').on(t.quizId, t.position),
    check(
      'chk_correct_label_range',
      sql`${t.correctOptionLabel} IS NULL OR ${t.correctOptionLabel} IN ('A', 'B', 'C', 'D')`
    ),
    check(
      'chk_options_only_mcq',
      sql`${t.options} IS NULL OR ${t.questionType} = 'mcq'`
    ),
    check(
      'chk_written_no_label_or_options',
      sql`${t.questionType} != 'written' OR (${t.correctOptionLabel} IS NULL AND ${t.options} IS NULL)`
    ),
    check(
      'chk_label_required_for_mcq_tf',
      sql`(${t.questionType} IN ('mcq', 'true_false')) = (${t.correctOptionLabel} IS NOT NULL)`
    ),
  ]
)

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => quizAttempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => quizQuestions.id),
    selectedLabel: char('selected_label', { length: 1 }),
    writtenAnswerText: text('written_answer_text'),
    isCorrect: boolean('is_correct'),
    pointsAwarded: numeric('points_awarded', { precision: 6, scale: 2 }),
    gradedByTeacherId: uuid('graded_by_teacher_id').references(() => teachers.id),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    teacherFeedback: text('teacher_feedback'),
  },
  (t) => [
    unique('quiz_answers_attempt_id_question_id_unique').on(
      t.attemptId,
      t.questionId
    ),
    check(
      'chk_answer_label_range',
      sql`${t.selectedLabel} IS NULL OR ${t.selectedLabel} IN ('A', 'B', 'C', 'D')`
    ),
    index('idx_quiz_answers_attempt').on(t.attemptId),
  ]
)

// =====================================================================
// RELATIONS
// =====================================================================

export const adminsRelations = relations(admins, ({ many }) => ({
  teachers: many(teachers),
}))

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  createdByAdmin: one(admins, {
    fields: [teachers.createdByAdminId],
    references: [admins.id],
  }),
  accessRequests: many(teacherAccessRequests),
  redemptionCodes: many(redemptionCodes),
  lectures: many(lectures),
  walletTransactions: many(walletTransactions),
  gradedAnswers: many(quizAnswers),
}))

export const studentsRelations = relations(students, ({ many }) => ({
  passwordResetTokens: many(passwordResetTokens),
  emailVerificationTokens: many(emailVerificationTokens),
  devices: many(studentDevices),
  accessRequests: many(teacherAccessRequests),
  walletTransactions: many(walletTransactions),
  codeRedemptions: many(codeRedemptions),
  payments: many(payments),
  lecturePurchases: many(lecturePurchases),
  lectureViews: many(lectureViews),
  quizAttempts: many(quizAttempts),
}))

export const passwordResetTokensRelations = relations(
  passwordResetTokens,
  ({ one }) => ({
    student: one(students, {
      fields: [passwordResetTokens.studentId],
      references: [students.id],
    }),
  })
)

export const emailVerificationTokensRelations = relations(
  emailVerificationTokens,
  ({ one }) => ({
    student: one(students, {
      fields: [emailVerificationTokens.studentId],
      references: [students.id],
    }),
  })
)

export const studentDevicesRelations = relations(studentDevices, ({ one, many }) => ({
  student: one(students, {
    fields: [studentDevices.studentId],
    references: [students.id],
  }),
  lectureViews: many(lectureViews),
}))

export const teacherAccessRequestsRelations = relations(
  teacherAccessRequests,
  ({ one }) => ({
    student: one(students, {
      fields: [teacherAccessRequests.studentId],
      references: [students.id],
    }),
    teacher: one(teachers, {
      fields: [teacherAccessRequests.teacherId],
      references: [teachers.id],
    }),
  })
)

export const walletTransactionsRelations = relations(
  walletTransactions,
  ({ one, many }) => ({
    student: one(students, {
      fields: [walletTransactions.studentId],
      references: [students.id],
    }),
    teacher: one(teachers, {
      fields: [walletTransactions.teacherId],
      references: [teachers.id],
    }),
    codeRedemptions: many(codeRedemptions),
    payments: many(payments),
    lecturePurchases: many(lecturePurchases),
  })
)

export const redemptionCodesRelations = relations(redemptionCodes, ({ one, many }) => ({
  teacher: one(teachers, {
    fields: [redemptionCodes.teacherId],
    references: [teachers.id],
  }),
  redemptions: many(codeRedemptions),
}))

export const codeRedemptionsRelations = relations(codeRedemptions, ({ one }) => ({
  code: one(redemptionCodes, {
    fields: [codeRedemptions.codeId],
    references: [redemptionCodes.id],
  }),
  student: one(students, {
    fields: [codeRedemptions.studentId],
    references: [students.id],
  }),
  walletTransaction: one(walletTransactions, {
    fields: [codeRedemptions.walletTransactionId],
    references: [walletTransactions.id],
  }),
}))

export const paymentsRelations = relations(payments, ({ one }) => ({
  student: one(students, {
    fields: [payments.studentId],
    references: [students.id],
  }),
  walletTransaction: one(walletTransactions, {
    fields: [payments.walletTransactionId],
    references: [walletTransactions.id],
  }),
}))

export const lecturesRelations = relations(lectures, ({ one, many }) => ({
  teacher: one(teachers, {
    fields: [lectures.teacherId],
    references: [teachers.id],
  }),
  videos: many(videos),
  files: many(files),
  contentItems: many(lectureContentItems),
  quizzes: many(quizzes),
  purchases: many(lecturePurchases),
  views: many(lectureViews),
}))

export const videosRelations = relations(videos, ({ one }) => ({
  lecture: one(lectures, {
    fields: [videos.lectureId],
    references: [lectures.id],
  }),
}))

export const filesRelations = relations(files, ({ one }) => ({
  lecture: one(lectures, {
    fields: [files.lectureId],
    references: [lectures.id],
  }),
}))

export const lectureContentItemsRelations = relations(
  lectureContentItems,
  ({ one }) => ({
    lecture: one(lectures, {
      fields: [lectureContentItems.lectureId],
      references: [lectures.id],
    }),
  })
)

export const lecturePurchasesRelations = relations(lecturePurchases, ({ one }) => ({
  student: one(students, {
    fields: [lecturePurchases.studentId],
    references: [students.id],
  }),
  lecture: one(lectures, {
    fields: [lecturePurchases.lectureId],
    references: [lectures.id],
  }),
  walletTransaction: one(walletTransactions, {
    fields: [lecturePurchases.walletTransactionId],
    references: [walletTransactions.id],
  }),
}))

export const lectureViewsRelations = relations(lectureViews, ({ one }) => ({
  student: one(students, {
    fields: [lectureViews.studentId],
    references: [students.id],
  }),
  lecture: one(lectures, {
    fields: [lectureViews.lectureId],
    references: [lectures.id],
  }),
  device: one(studentDevices, {
    fields: [lectureViews.deviceId],
    references: [studentDevices.id],
  }),
}))

export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
  lecture: one(lectures, {
    fields: [quizzes.lectureId],
    references: [lectures.id],
  }),
  questions: many(quizQuestions),
  attempts: many(quizAttempts),
}))

export const quizAttemptsRelations = relations(quizAttempts, ({ one, many }) => ({
  quiz: one(quizzes, {
    fields: [quizAttempts.quizId],
    references: [quizzes.id],
  }),
  student: one(students, {
    fields: [quizAttempts.studentId],
    references: [students.id],
  }),
  answers: many(quizAnswers),
}))

export const quizQuestionsRelations = relations(quizQuestions, ({ one, many }) => ({
  quiz: one(quizzes, {
    fields: [quizQuestions.quizId],
    references: [quizzes.id],
  }),
  answers: many(quizAnswers),
}))

export const quizAnswersRelations = relations(quizAnswers, ({ one }) => ({
  attempt: one(quizAttempts, {
    fields: [quizAnswers.attemptId],
    references: [quizAttempts.id],
  }),
  question: one(quizQuestions, {
    fields: [quizAnswers.questionId],
    references: [quizQuestions.id],
  }),
  gradedByTeacher: one(teachers, {
    fields: [quizAnswers.gradedByTeacherId],
    references: [teachers.id],
    relationName: 'gradedAnswers',
  }),
}))

// =====================================================================
// INFERRED TYPES
// =====================================================================

export type Admin = typeof admins.$inferSelect
export type Teacher = typeof teachers.$inferSelect
export type Student = typeof students.$inferSelect
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect
export type StudentDevice = typeof studentDevices.$inferSelect
export type TeacherAccessRequest = typeof teacherAccessRequests.$inferSelect
export type WalletTransaction = typeof walletTransactions.$inferSelect
export type RedemptionCode = typeof redemptionCodes.$inferSelect
export type CodeRedemption = typeof codeRedemptions.$inferSelect
export type Payment = typeof payments.$inferSelect
export type Lecture = typeof lectures.$inferSelect
export type Video = typeof videos.$inferSelect
export type File = typeof files.$inferSelect
export type LectureContentItem = typeof lectureContentItems.$inferSelect
export type LecturePurchase = typeof lecturePurchases.$inferSelect
export type LectureView = typeof lectureViews.$inferSelect
export type Quiz = typeof quizzes.$inferSelect
export type QuizAttempt = typeof quizAttempts.$inferSelect
export type QuizQuestion = typeof quizQuestions.$inferSelect
export type QuizAnswer = typeof quizAnswers.$inferSelect

// =====================================================================
// NOTE: The following DDL objects cannot be expressed purely in the
// Drizzle schema definition and must be applied via raw SQL in a
// migration (e.g. ./migrations/0000_extensions.sql):
//
//   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
//   CREATE EXTENSION IF NOT EXISTS "citext";
//
//   CREATE OR REPLACE FUNCTION trg_set_updated_at() ...
//   CREATE TRIGGER set_updated_at BEFORE UPDATE ON teachers/students/...
//
//   CREATE OR REPLACE FUNCTION cleanup_expired_lectures() ...
//
// The `citext` custom type above assumes the extension is installed.
// =====================================================================
