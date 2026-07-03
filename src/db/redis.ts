import { Redis } from 'ioredis'
import { env, isProd } from '../../env.ts'
import { remember } from '@epic-web/remember'

const createRedisClient = () => {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  })

  client.on('error', (err: Error) => {
    console.error('[redis] connection error:', err.message)
  })

  client.on('connect', () => {
    if (!isProd()) console.debug('[redis] connected')
  })

  return client
}

export const redis = isProd()
  ? createRedisClient()
  : remember('redisClient', () => createRedisClient())

export default redis
