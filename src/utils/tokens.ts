import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

/**
 * Generates a random opaque token (URL-safe base64url) and returns both the
 * raw token (sent to the user) and its SHA-256 hash (stored in the DB).
 */
export const generateTokenPair = (): { token: string; tokenHash: string } => {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  return { token, tokenHash }
}

/** SHA-256 hex hash of a token. Never store raw tokens. */
export const hashToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of two hex digests. */
export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
