import { Router } from 'express'
import authRoutes from './v1/authRoutes.ts'
import adminRoutes from './v1/adminRoutes.ts'

/**
 * Central route registry.
 *
 * All API versioning is managed here so `server.ts` only mounts a single
 * `/api` router. Add new versions (v2, ...) and feature routers below.
 */
const router = Router()

// --- v1 -------------------------------------------------------------------
const v1 = Router()
v1.use('/auth', authRoutes)
v1.use('/admin', adminRoutes)
// v1.use('/students', studentRoutes)
// v1.use('/teachers', teacherRoutes)

router.use('/v1', v1)

export default router
