import type { APIRoute } from 'astro'
import { db } from '@/lib/database'

export const prerender = false

export const GET: APIRoute = async () => {
  try {
    await db.execute('SELECT 1')
    return Response.json({ status: 'ok' })
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 })
  }
}
