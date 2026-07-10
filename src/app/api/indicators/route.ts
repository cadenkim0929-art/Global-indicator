import { NextRequest, NextResponse } from 'next/server';
import { getIndicatorCards, getIndicatorMeta, getFrequencyCounts } from '@/lib/indicator-store';
import type { IndicatorFrequency } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const freq = req.nextUrl.searchParams.get('frequency') as IndicatorFrequency | null;
    const cards = getIndicatorCards(freq || undefined);
    const meta = getIndicatorMeta();
    const counts = getFrequencyCounts();
    return NextResponse.json({ cards, meta, counts }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'Failed to load indicators' }, { status: 500 });
  }
}
