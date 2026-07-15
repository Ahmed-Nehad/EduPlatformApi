import { z } from 'zod'

// POST /wallet/redeem — redeem a teacher's code
export const redeemCodeSchema = z.object({
  body: z.object({
    code: z.string().min(1).max(40),
  }),
})

// GET /wallet/balance — no params (returns per-teacher balances)
export const getBalanceSchema = z.object({})

// GET /wallet/transactions — paginated ledger
export const listTransactionsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
})
