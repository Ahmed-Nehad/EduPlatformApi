import type { Response } from 'express'
import { db } from '../db/connection.ts'
import {
  lectures,
  lectureContentItems,
  videos,
  files,
  quizzes,
} from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

/** The polymorphic content types a lecture can reference. */
type ContentType = 'video' | 'file' | 'quiz'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verifies that a content row exists for a given (content_type, content_id)
 * and that it belongs to the same lecture. Throws 404 CONTENT_NOT_FOUND when
 * the referenced row is missing or does not belong to the lecture.
 *
 * This guards `addContentItem` against attaching a foreign teacher's content
 * (or a non-existent row) to a lecture.
 */
const assertContentBelongsToLecture = async (
  contentType: ContentType,
  contentId: string,
  lectureId: string
): Promise<void> => {
  if (contentType === 'video') {
    const [row] = await db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(
          eq(videos.id, contentId),
          eq(videos.lectureId, lectureId),
          isNull(videos.deletedAt)
        )
      )
      .limit(1)
    if (!row) throw contentNotFound()
  } else if (contentType === 'file') {
    const [row] = await db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.id, contentId),
          eq(files.lectureId, lectureId),
          isNull(files.deletedAt)
        )
      )
      .limit(1)
    if (!row) throw contentNotFound()
  } else {
    const [row] = await db
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(and(eq(quizzes.id, contentId), eq(quizzes.lectureId, lectureId)))
      .limit(1)
    if (!row) throw contentNotFound()
  }
}

const contentNotFound = () =>
  AppError.notFound(
    'CONTENT_NOT_FOUND',
    'The referenced content does not exist or does not belong to this lecture'
  )

// ---------------------------------------------------------------------------
// POST /teacher/lectures/:id/content — add a video/file/quiz item
// ---------------------------------------------------------------------------

/**
 * Adds a content item to a lecture's ordered content list. The lecture must be
 * owned by the caller (ownership via WHERE) and the referenced content row
 * must exist and belong to the same lecture.
 *
 * The `(lecture_id, position)` unique constraint prevents two items from
 * sharing a slot; a collision is translated to 409 POSITION_TAKEN.
 */
export const addContentItem = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { id } = req.params
  const { content_type, content_id, position } = req.body as {
    content_type: ContentType
    content_id: string
    position: number
  }

  // 1. Lecture must exist, be owned by the caller, and not be deleted.
  //    Ownership is folded into the WHERE so a foreign lecture is
  //    indistinguishable from a missing one (404, not 403).
  const [lecture] = await db
    .select({ id: lectures.id })
    .from(lectures)
    .where(
      and(
        eq(lectures.id, id),
        eq(lectures.teacherId, teacherId),
        isNull(lectures.deletedAt)
      )
    )
    .limit(1)

  if (!lecture) {
    throw AppError.notFound(
      'LECTURE_NOT_FOUND',
      'Lecture not found or not owned by you'
    )
  }

  // 2. The referenced content row must exist and belong to this lecture.
  await assertContentBelongsToLecture(content_type, content_id, id)

  // 3. Insert the ordering row. The unique constraints are the race backstop.
  let created: typeof lectureContentItems.$inferSelect
  try {
    const [row] = await db
      .insert(lectureContentItems)
      .values({
        lectureId: id,
        contentType: content_type,
        contentId: content_id,
        position,
      })
      .returning()
    created = row
  } catch (err) {
    // Unique violation on (lecture_id, position) or (lecture_id, type, id).
    throw AppError.conflict(
      'POSITION_TAKEN',
      'That position is already taken, or the content is already attached to this lecture'
    )
  }

  res.status(201).json({ success: true, data: { contentItem: created } })
}

// ---------------------------------------------------------------------------
// PATCH /teacher/lectures/:id/content — bulk reorder
// ---------------------------------------------------------------------------

/**
 * Bulk-reorders the content items of a lecture. Each item in the payload is
 * updated to its new position in a single transaction. The lecture must be
 * owned by the caller, and every `item_id` in the payload must belong to the
 * lecture.
 *
 * Because the `(lecture_id, position)` unique constraint would reject an
 * intermediate collision, the items are first shifted to temporary negative
 * positions (guaranteed unique) before being set to their final values.
 */
export const reorderContent = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { id } = req.params
  const { items } = req.body as {
    items: { item_id: string; position: number }[]
  }

  // 1. Lecture must exist and be owned by the caller. Ownership is folded
  //    into the WHERE so a foreign lecture is indistinguishable from a
  //    missing one (404, not 403).
  const [lecture] = await db
    .select({ id: lectures.id })
    .from(lectures)
    .where(
      and(
        eq(lectures.id, id),
        eq(lectures.teacherId, teacherId),
        isNull(lectures.deletedAt)
      )
    )
    .limit(1)

  if (!lecture) {
    throw AppError.notFound(
      'LECTURE_NOT_FOUND',
      'Lecture not found or not owned by you'
    )
  }

  // 2. Every item_id must belong to this lecture.
  const itemIds = items.map((i) => i.item_id)
  const owned = await db
    .select({ id: lectureContentItems.id })
    .from(lectureContentItems)
    .where(
      and(
        eq(lectureContentItems.lectureId, id),
        inArray(lectureContentItems.id, itemIds)
      )
    )

  if (owned.length !== itemIds.length) {
    throw AppError.notFound(
      'CONTENT_ITEM_NOT_FOUND',
      'One or more content items do not belong to this lecture'
    )
  }

  // 3. Two-phase update to avoid transient (lecture_id, position) collisions:
  //    first shift every target row to a unique negative position, then set
  //    the final positions. Both phases run in a single transaction.
  await db.transaction(async (tx) => {
    // Phase 1: move to temporary negative positions (index-based, unique).
    for (let i = 0; i < items.length; i++) {
      await tx
        .update(lectureContentItems)
        .set({ position: -(i + 1) })
        .where(
          and(
            eq(lectureContentItems.lectureId, id),
            eq(lectureContentItems.id, items[i].item_id)
          )
        )
    }
    // Phase 2: set the final positions.
    for (const { item_id, position } of items) {
      await tx
        .update(lectureContentItems)
        .set({ position })
        .where(
          and(
            eq(lectureContentItems.lectureId, id),
            eq(lectureContentItems.id, item_id)
          )
        )
    }
  })

  // 4. Return the updated ordering for confirmation.
  const updated = await db
    .select({
      id: lectureContentItems.id,
      content_type: lectureContentItems.contentType,
      content_id: lectureContentItems.contentId,
      position: lectureContentItems.position,
    })
    .from(lectureContentItems)
    .where(eq(lectureContentItems.lectureId, id))
    .orderBy(asc(lectureContentItems.position))

  res.status(200).json({ success: true, data: { contentItems: updated } })
}

// ---------------------------------------------------------------------------
// DELETE /teacher/lectures/:id/content/:itemId — remove an item
// ---------------------------------------------------------------------------

/**
 * Removes a content item from a lecture's ordered list. Ownership of the
 * lecture is enforced via the JOIN/WHERE, so an item belonging to another
 * teacher's lecture yields a 404.
 */
export const removeContentItem = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const teacherId = req.user!.id
  const { id, itemId } = req.params

  const [deleted] = await db
    .delete(lectureContentItems)
    .where(
      and(
        eq(lectureContentItems.id, itemId),
        eq(lectureContentItems.lectureId, id),
        // Ownership: only delete if the item's lecture belongs to the caller.
        inArray(
          lectureContentItems.lectureId,
          db
            .select({ id: lectures.id })
            .from(lectures)
            .where(eq(lectures.teacherId, teacherId))
        )
      )
    )
    .returning({ id: lectureContentItems.id })

  if (!deleted) {
    throw AppError.notFound(
      'CONTENT_ITEM_NOT_FOUND',
      'Content item not found or not owned by you'
    )
  }

  res.status(200).json({ success: true, data: { contentItem: deleted } })
}
