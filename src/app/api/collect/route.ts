import { NextResponse } from 'next/server';
import { collectFeeds, getStats } from '@/lib/news-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const token = process.env.COLLECT_SECRET;
  const supplied = request.headers.get('x-collect-secret');
  if (token && supplied !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const maxFeeds = body.maxFeeds ? Number(body.maxFeeds) : undefined;
  const perCategory = body.perCategory ? Number(body.perCategory) : undefined;
  const concurrency = body.concurrency ? Number(body.concurrency) : undefined;
  const result = await collectFeeds({
    maxFeeds,
    perCategory,
    concurrency,
    category: typeof body.category === 'string' ? body.category : undefined,
    balanced: Boolean(body.balanced),
  });
  return NextResponse.json({ ok: true, result, stats: getStats() });
}

export async function GET() {
  return NextResponse.json({ message: 'Use POST /api/collect with optional {"maxFeeds": 10}.', stats: getStats() });
}
