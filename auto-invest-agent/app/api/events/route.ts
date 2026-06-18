import { NextResponse } from 'next/server'
import { readEvents } from '../../../src/events'

export const dynamic = 'force-dynamic'

export async function GET() {
  // newest first, capped
  return NextResponse.json({ events: readEvents().slice(-50).reverse() })
}
