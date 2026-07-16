import { NextResponse } from 'next/server';
import { getStats, queryArticles, enrichWithTranslations, DEFAULT_LOOKBACK_DAYS } from '@/lib/news-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || undefined;
  const query = searchParams.get('q') || undefined;
  const tag = searchParams.get('tag') || undefined;
  const limit = Number(searchParams.get('limit') || 200);
  const days = searchParams.get('days') ? Number(searchParams.get('days')) : DEFAULT_LOOKBACK_DAYS;
  const articles = await enrichWithTranslations(queryArticles({ category, query, tag, limit, days }), { maxTranslate: 0 });
  return NextResponse.json({ articles, stats: getStats(days) });
}
