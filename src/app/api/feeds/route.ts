import { NextResponse } from 'next/server';
import { getFeeds } from '@/lib/news-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const feeds = getFeeds();
    return NextResponse.json({ allFeeds: feeds });
  } catch {
    return NextResponse.json({ error: 'Failed to load feeds' }, { status: 500 });
  }
}
