Here is a complete REST API design for your platform. I have organized it by domain, included the auth/device architecture, and mapped every requirement to concrete endpoints.

---

## 1. API Foundations

| Item | Specification |
|------|---------------|
| **Base URL** | `https://api.yourplatform.com/v1` |
| **Format** | JSON |
| **Auth** | Session-based (`HttpOnly` cookie: `session_id`) |
| **Session Store** | Redis (`session:{uuid}` → JSON payload, TTL 24h) |
| **Device Tracking** | `X-Device-Fingerprint` header (SHA-256 hash) required for all Student requests |
| **Response Envelope** | `{ "success": true, "data": {}, "meta": {} }` |
| **Errors** | `{ "success": false, "error": { "code": "...", "message": "..." } }` |

### Redis Session Structure
```json
{
  "user_id": "uuid",
  "role": "student|teacher|admin",
  "device_id": "uuid",        // only for students
  "email": "user@example.com",
  "issued_at": "2026-07-02T10:00:00Z"
}
```

### Middleware Stack
1. `extractSession` — validates cookie, loads Redis session, attaches `req.user`
2. `requireAuth` — rejects `401` if no session
3. `requireRole(...roles)` — rejects `403` if role mismatch
4. `requireStudentDevice` — for students only: verifies fingerprint matches an active bound device slot (1 or 2). Rejects `403` if unknown device and both slots occupied.
5. `requireTeacherOwnership` — ensures the teacher owns the lecture/quiz/code
6. `requireStudentAccess` — ensures student has an **approved** `teacher_access_request` for the target teacher
7. `requirePurchase` — ensures student has purchased the lecture

---

## 2. Authentication & Identity

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/register` | Public | Student sign-up |
| `POST` | `/auth/login` | Public | Universal login (returns role-specific user object) |
| `POST` | `/auth/logout` | Any | Destroys Redis session; clears cookie |
| `GET`  | `/auth/me` | Any | Current user profile |
| `POST` | `/auth/password-reset-request` | Public | Sends reset email to student |
| `POST` | `/auth/password-reset` | Public | Consumes token, sets new password |
| `GET`  | `/auth/devices` | Student | List my 2 bound devices |
| `DELETE`| `/auth/devices/:id` | Student | Self-revoke a device (frees the slot) |

### `POST /auth/login` (Student Example)
**Request:**
```json
{
  "email": "student@example.com",
  "password": "secret",
  "device_fingerprint": "sha256:abc123...",
  "device_label": "Chrome 126 / Windows 11"
}
```
**Behavior:**
- If fingerprint exists for this student → allow, refresh `last_seen_at`
- If new fingerprint and `< 2` active slots → bind to next slot (1 or 2)
- If new fingerprint and `2` slots full → `403` error: `DEVICE_LIMIT_REACHED`

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "name": "...", "role": "student" },
    "device_id": "...",
    "expires_at": "2026-07-03T10:00:00Z"
  }
}
```

---

## 3. Admin Endpoints

Teachers **cannot** self-register. The admin creates accounts.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/admin/teachers` | Admin | Create teacher account |
| `GET`  | `/admin/teachers` | Admin | List all teachers |
| `GET`  | `/admin/students` | Admin | List all students |
| `DELETE`| `/admin/devices/:id` | Admin | Force-revoke a student device (frees slot) |

### `POST /admin/teachers`
```json
{
  "name": "Dr. Ahmed",
  "email": "ahmed@platform.com",
  "password": "tempPassword123",
  "bio": "Mathematics specialist"
}
```

---

## 4. Teacher — Student Access Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET`  | `/teacher/access-requests?status=pending` | Teacher | Pending requests for me |
| `POST` | `/teacher/access-requests/:id/approve` | Teacher | Approve a student |
| `POST` | `/teacher/access-requests/:id/reject` | Teacher | Reject a student |
| `GET`  | `/teacher/students` | Teacher | My approved students |

---

## 5. Teacher — Lectures & Content

### Lectures
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/lectures` | Teacher | Create lecture (status=`draft`) |
| `GET`  | `/lectures` | Any | Browse lectures (public catalog; no content) |
| `GET`  | `/lectures/:id` | Any | Lecture detail (content items hidden unless purchased) |
| `PATCH`| `/lectures/:id` | Teacher | Update title, description, price, thumbnail, status |
| `DELETE`| `/lectures/:id` | Teacher | Soft delete (`deleted_at`) |

### Content Ordering (Polymorphic)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/lectures/:id/content` | Teacher | Add video/file/quiz to lecture |
| `PATCH`| `/lectures/:id/content` | Teacher | Bulk reorder items |
| `DELETE`| `/lectures/:id/content/:itemId` | Teacher | Remove item from lecture |

### `POST /lectures/:id/content`
```json
{
  "content_type": "video",   // video | file | quiz
  "content_id": "uuid-of-video",
  "position": 1
}
```

### `PATCH /lectures/:id/content` (Reorder)
```json
{
  "items": [
    { "item_id": "uuid-1", "position": 1 },
    { "item_id": "uuid-2", "position": 2 }
  ]
}
```

---

## 6. Teacher — Videos (VdoCipher)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/videos` | Teacher | Register a VdoCipher video ID after upload |
| `PATCH`| `/videos/:id` | Teacher | Update title/duration |
| `POST` | `/videos/webhook/vdocipher` | Public* | VdoCipher status callbacks |
| `GET`  | `/videos/:id/playback` | Student | Get OTP for playback |

### `POST /videos`
```json
{
  "lecture_id": "uuid",
  "vdocipher_video_id": "vdo_xxxx",
  "title": "Introduction",
  "duration_seconds": 900,
  "size_bytes": 157286400
}
```
*Backend should call VdoCipher API to verify the `vdocipher_video_id` exists.*

### `GET /videos/:id/playback` (Student)
**Checks:** purchased lecture + valid device.  
**Response:**
```json
{
  "vdocipher_video_id": "vdo_xxxx",
  "otp": "generated-otp-from-vdocipher-api",
  "playback_url": "https://player.vdocipher.com/v2/?otp=..."
}
```
*Backend calls VdoCipher server-side API to generate a single-use OTP.*

---

## 7. Teacher — Files (Cloudflare R2)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/uploads/presigned` | Any* | Get a presigned R2 PUT URL |
| `POST` | `/files` | Teacher | Confirm file upload & attach to lecture |
| `GET`  | `/files/:id/download` | Student | Get presigned R2 GET URL (15 min expiry) |

### `POST /uploads/presigned` (Generic Upload)
```json
{
  "context": "lecture_file",   // lecture_file | question_image | avatar | lecture_thumbnail
  "filename": "notes.pdf",
  "content_type": "application/pdf",
  "size_bytes": 5242880,
  "parent_id": "lecture-uuid"
}
```
**Response:**
```json
{
  "upload_url": "https://r2.cloudflare.com/...?X-Amz-Signature=...",
  "r2_key": "lectures/uuid/files/uuid-notes.pdf",
  "expires_in": 300
}
```

### `POST /files` (Confirm after PUT to R2)
```json
{
  "lecture_id": "uuid",
  "r2_object_key": "lectures/uuid/files/uuid-notes.pdf",
  "title": "Lecture Notes",
  "size_bytes": 5242880
}
```

---

## 8. Teacher — Quizzes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/quizzes` | Teacher | Create quiz for a lecture |
| `GET`  | `/quizzes/:id` | Teacher | Full quiz data (includes correct answers) |
| `PATCH`| `/quizzes/:id` | Teacher | Update settings (lock_mode, lock_until, etc.) |
| `POST` | `/quizzes/:id/questions` | Teacher | Add question |
| `PATCH`| `/quizzes/:id/questions/:qid` | Teacher | Edit question |
| `DELETE`| `/quizzes/:id/questions/:qid` | Teacher | Delete question |

### `POST /quizzes`
```json
{
  "lecture_id": "uuid",
  "title": "Week 1 Quiz",
  "lock_mode": "after_submission",   // or "calendar"
  "lock_until": null,                // required if calendar
  "allow_multiple_attempts": false
}
```

### `POST /quizzes/:id/questions`
```json
{
  "question_text": "What is 2+2?",
  "question_type": "mcq",
  "options": { "A": "3", "B": "4", "C": "5" },
  "correct_option_label": "B",
  "points": 2,
  "image_r2_key": null,
  "position": 1
}
```
*For `written`: omit `options` and `correct_option_label`. For `true_false`: `correct_option_label` is `A`(True) or `B`(False).*

---

## 9. Student — Quiz Attempts & Grading

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/quizzes/:id/attempts` | Student | Start a new attempt |
| `GET`  | `/quiz-attempts/:id` | Student | Get attempt questions (during `in_progress`) |
| `POST` | `/quiz-attempts/:id/submit` | Student | Finalize attempt |
| `GET`  | `/quiz-attempts/:id/results` | Student | View answers & score (gated by lock period) |
| `GET`  | `/teacher/quiz-attempts?needs_grading=true` | Teacher | List ungraded written attempts |
| `POST` | `/quiz-attempts/:id/grade` | Teacher | Grade written answers |

### `POST /quizzes/:id/attempts`
**Rules enforced:**
- Student must have purchased the parent lecture
- If `allow_multiple_attempts=false`, reject if any prior `submitted` attempt exists
- Creates attempt with `status=in_progress`

**Response:**
```json
{
  "attempt_id": "uuid",
  "attempt_number": 1,
  "questions": [
    {
      "id": "q-uuid",
      "question_text": "...",
      "question_type": "mcq",
      "options": { "A": "...", "B": "..." },
      "image_url": "https://cdn.../img.png",
      "points": 2
    }
  ]
}
```
*Note: `correct_option_label` is NEVER returned to students.*

### `POST /quiz-attempts/:id/submit`
```json
{
  "answers": [
    { "question_id": "q-1", "selected_label": "B" },
    { "question_id": "q-2", "written_answer_text": "My explanation..." }
  ]
}
```
**Backend actions:**
1. Set `status=submitted`, `submitted_at=now()`
2. Auto-grade all `mcq`/`true_false` answers against `quiz_questions.correct_option_label`
3. Set `is_correct` and `points_awarded` for auto-graded questions
4. Leave written answers `is_correct=null` (pending teacher)

### `GET /quiz-attempts/:id/results`
**Access Control:**
- Reject if `status != 'submitted'`
- If `lock_mode='calendar'` and `now() < lock_until` → `403 LOCKED`
- If written answers exist and `graded_at IS NULL` → `403 NOT_GRADED`

**Response:**
```json
{
  "score": 8.5,
  "total_points": 10,
  "graded_at": "2026-07-02T12:00:00Z",
  "answers": [
    {
      "question_id": "q-1",
      "question_text": "What is 2+2?",
      "correct_option_label": "B",
      "your_label": "B",
      "is_correct": true,
      "points_awarded": 2,
      "teacher_feedback": null
    }
  ]
}
```

### `POST /quiz-attempts/:id/grade` (Teacher)
```json
{
  "grades": [
    {
      "answer_id": "uuid",
      "is_correct": true,
      "points_awarded": 2,
      "teacher_feedback": "Well explained!"
    }
  ]
}
```
**Backend:** If all written answers for this attempt now have `is_correct NOT NULL`, set `attempt.graded_at=now()` and sum the final `score`.

---

## 10. Wallet, Payments & Codes

### Redemption Codes (Teacher)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/codes` | Teacher | Generate a code |
| `GET`  | `/codes` | Teacher | List my codes (active & soft-deleted) |
| `DELETE`| `/codes/:id` | Teacher | Soft delete (`deleted_at=now()`) |

### `POST /codes`
```json
{
  "code": "MATH2026",
  "credit_amount": 150.00,
  "expires_at": "2026-12-31T23:59:59Z"
}
```

### Wallet & Payments (Student)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/wallet/redeem` | Student | Redeem a teacher's code |
| `GET`  | `/wallet/balance` | Student | Current balance (O(1) read from latest tx) |
| `GET`  | `/wallet/transactions` | Student | Ledger history |
| `POST` | `/payments/deposit` | Student | Initiate Kashier deposit |
| `GET`  | `/payments` | Student | Payment history |
| `POST` | `/payments/webhook/kashier` | Public | Kashier IPN/callback |

### `POST /wallet/redeem`
```json
{ "code": "MATH2026" }
```
**Atomic transaction:**
1. Verify code: active, not deleted, not expired, not yet redeemed (`UNIQUE(code_id)` constraint)
2. Insert `code_redemptions` row
3. Insert `wallet_transactions` (`type='credit_code'`, `amount=150.00`, `balance_after=previous+150`)

### `POST /payments/deposit`
```json
{ "amount": 200.00, "currency": "EGP" }
```
**Response:**
```json
{
  "payment_id": "uuid",
  "kashier_checkout_url": "https://checkout.kashier.io/?orderId=..."
}
```
**Flow:**
1. Backend creates `payments` row (`status=pending`)
2. Generates Kashier order with `provider_reference=payment_id`
3. User pays on Kashier
4. Kashier redirects/calls webhook → backend verifies signature → updates `status=success` → creates `wallet_transactions` (`type='credit_payment'`)

---

## 11. Student — Lectures & Purchases

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET`  | `/teachers` | Any | Browse all active teachers |
| `GET`  | `/teachers/:id/lectures` | Any | See this teacher's published lectures (catalog) |
| `POST` | `/teachers/:id/access-requests` | Student | Request access to a teacher |
| `GET`  | `/student/my-teachers` | Student | Teachers who approved me |
| `POST` | `/lectures/:id/purchase` | Student | Buy lecture with wallet |
| `GET`  | `/student/purchases` | Student | My purchased lectures |

### `POST /lectures/:id/purchase`
**Checks:**
1. Lecture is `published`, not expired, not deleted
2. Student has **approved** access to the lecture's teacher
3. Student has not already purchased this lecture
4. `wallet.balance >= lecture.price`

**Atomic transaction:**
1. Insert `wallet_transactions` (`type='debit_purchase'`, `amount=price`, `balance_after=old-price`)
2. Insert `lecture_purchases`
3. Return purchase confirmation

---

## 12. Teacher — Analytics

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET`  | `/teacher/lectures/:id/views` | Teacher | Who viewed this lecture's content |
| `GET`  | `/teacher/analytics` | Teacher | Aggregated stats |

### `GET /teacher/lectures/:id/views`
```json
{
  "data": [
    {
      "student_id": "uuid",
      "student_name": "Ali",
      "content_type": "video",
      "content_title": "Intro",
      "watch_seconds": 845,
      "device_label": "Chrome / Windows",
      "viewed_at": "2026-07-01T14:00:00Z"
    }
  ],
  "meta": { "total": 45, "page": 1 }
}
```

---

## 13. Key Architectural Notes

### A. Device Binding (2-Device Lock)
- Enforced in `POST /auth/login` and middleware `requireStudentDevice`.
- If a student tries to log in from a 3rd unknown device while 2 active slots are occupied, return:
  ```json
  { "success": false, "error": { "code": "DEVICE_LIMIT_REACHED", "message": "Maximum 2 devices allowed. Revoke one from your profile or contact support." } }
  ```
- Admin can force-revoke via `DELETE /admin/devices/:id` to free a slot.

### B. Video Security (VdoCipher)
- Never expose the raw VdoCipher video URL.
- `GET /videos/:id/playback` calls the VdoCipher server API using your secret key to generate a short-lived OTP (e.g., 6 hours) and returns it to the authenticated, authorized student.
- The frontend player initializes with `video_id` + `otp`.

### C. File Security (R2)
- Never make R2 buckets public.
- `GET /files/:id/download` generates a presigned `GET` URL valid for 15 minutes.
- For uploads, `POST /uploads/presigned` generates a presigned `PUT` URL valid for 5 minutes.

### D. Quiz Locking Logic
Results visibility is enforced in `GET /quiz-attempts/:id/results`:

```python
if attempt.status != 'submitted':
    raise 403("Quiz not yet submitted")

if quiz.lock_mode == 'calendar' and now() < quiz.lock_until:
    raise 403("Answers locked until " + quiz.lock_until)

if has_written_questions and attempt.graded_at is None:
    raise 403("Written answers not yet graded by teacher")
```

### E. Auto-Deletion (1 Year Expiry)
- `lectures.expires_at` defaults to `now() + 1 year`.
- A nightly cron job calls `cleanup_expired_lectures()` (SQL function in your schema).
- The function returns deleted lecture IDs; your application or a queue worker should then call VdoCipher/R2 APIs to delete external assets.

### F. Ledger Wallet
- Never update a balance column directly.
- Every financial action inserts a `wallet_transactions` row.
- Current balance = `SELECT balance_after FROM wallet_transactions WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`.
- Use a DB transaction with `SERIALIZABLE` or optimistic locking on the student's latest transaction to prevent race conditions during purchases.

---

## 14. Suggested Next Steps

1. **Do you want me to generate an OpenAPI 3.0 (Swagger) spec** from this design so you can import it into Postman or generate client SDKs?
2. **Should I design the WebSocket or SSE flow** for real-time notifications (e.g., "Teacher approved your request")?
3. **Do you want the SQL queries / stored procedures** for the most complex atomic operations (purchase, redeem, device binding)?

Let me know which area you'd like to refine first, or if any endpoint needs adjustment!