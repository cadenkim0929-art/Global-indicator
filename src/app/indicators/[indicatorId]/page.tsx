import Link from 'next/link';
import { notFound } from 'next/navigation';
import IndicatorDetail from '@/app/ui/indicator-detail';
import { getGdpCountryDetail, getIndicatorDetail } from '@/lib/indicator-store';

export const dynamic = 'force-dynamic';

function seriesLabel(id: string) {
  if (id.startsWith('gdp_qoq_')) return id.includes('_te') ? '연간 성장률' : '성장률';
  if (id.startsWith('gdp_quarterly_')) return '분기 GDP';
  return '연간 GDP';
}

function seriesOrder(id: string) {
  if (id.startsWith('gdp_qoq_') && !id.includes('_te')) return 0;
  if (id.startsWith('gdp_quarterly_')) return 1;
  if (id.startsWith('gdp_qoq_')) return 2;
  return 3;
}

export default async function IndicatorDetailPage({ params }: { params: Promise<{ indicatorId: string }> }) {
  const { indicatorId } = await params;
  const country = indicatorId.startsWith('gdp-') ? indicatorId.slice(4) : null;

  if (country) {
    const bundle = getGdpCountryDetail(country);
    if (!bundle.length) notFound();
    const series = bundle
      .sort((a, b) => seriesOrder(a.id) - seriesOrder(b.id))
      .map((item) => ({ ...item, seriesLabel: seriesLabel(item.id) }));
    return <main className="detailPage">
      <header className="detailTopbar">
        <Link href="/?view=macro" className="detailBrand"><span>EP</span><b>Industry Monitor</b></Link>
        <Link href="/?view=macro" className="detailBack">← Macro</Link>
      </header>
      <IndicatorDetail
        title={`${country} GDP`}
        subtitle="Global growth frame"
        series={series}
        defaultSeriesId={series[0].id}
      />
    </main>;
  }

  const indicator = getIndicatorDetail(indicatorId);
  if (!indicator) notFound();
  return <main className="detailPage">
    <header className="detailTopbar">
      <Link href="/?view=macro" className="detailBrand"><span>EP</span><b>Industry Monitor</b></Link>
      <Link href="/?view=macro" className="detailBack">← Macro</Link>
    </header>
    <IndicatorDetail
      title={indicator.nameKo}
      subtitle={`${indicator.category} · ${indicator.frequency}`}
      series={[{ ...indicator, seriesLabel: indicator.nameKo }]}
      defaultSeriesId={indicator.id}
    />
  </main>;
}
