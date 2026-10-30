import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../state/AppContext.tsx';
import { CATEGORY_LABELS } from '../domain/categories.ts';
import type { Insights } from '../domain/insights.ts';
import { ICON_COLORS } from '../map/categoryIcons.ts';
import { densityColor } from '../map/density.ts';

function Stat({ label, value, tone = 'default', testId }: { label: string; value: number; tone?: 'default' | 'gold'; testId?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'gold' ? 'border-gold-400/60 bg-gold-100/70' : 'border-granite-200 bg-ivory-50/70'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-granite-500">{label}</p>
      <p className="font-display text-3xl font-semibold tabular-nums text-granite-900" data-testid={testId}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

export function InsightsDashboard({ insights }: { insights: Insights }) {
  const { state, dispatch, data } = useApp();
  const categoryData = insights.byCategory.map((c) => ({
    name: CATEGORY_LABELS[c.category],
    verified: c.verified,
    unverified: c.unverified,
    color: ICON_COLORS[c.category],
  }));
  const stateData = insights.byState.map((s) => ({ name: s.state, verified: s.verified, unverified: s.unverified }));
  const pieData = categoryData.filter((c) => c.verified > 0).map((c) => ({ name: c.name, value: c.verified, color: c.color }));
  const reports = Object.values(data.reports);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Geographic insights</h2>
        <p className="text-xs text-granite-600">
          Calculated in the browser from the {insights.totalPublished.toLocaleString()} published records and the
          district polygons loaded from /data.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Verified" value={insights.totalVerified} tone="gold" testId="insights-total-verified" />
        <Stat label="Unverified" value={insights.totalUnverified} />
        <Stat label="UNESCO" value={insights.unesco.inscribed + insights.unesco.component + insights.unesco.tentative} />
      </div>
      <p className="text-[11px] text-granite-500">
        UNESCO: {insights.unesco.inscribed} inscribed, {insights.unesco.component} components of a listed site,{' '}
        {insights.unesco.tentative} tentative (status from Wikidata). With photo {insights.withImage}, with description{' '}
        {insights.withDescription}, with dated period {insights.withPeriod}.
      </p>

      <section>
        <h3 className="mb-1 font-display text-lg font-semibold">By state</h3>
        <div className="h-[110px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stateData} layout="vertical" margin={{ left: 8, right: 12, top: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="verified" stackId="s" fill="#a3432a" name="Verified" />
              <Bar dataKey="unverified" stackId="s" fill="#dd9a80" name="Unverified" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3 className="mb-1 font-display text-lg font-semibold">By category</h3>
        <div className="grid grid-cols-[1fr_120px] items-center gap-2">
          <div className="h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} layout="vertical" margin={{ left: 8, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke="#ebe7e0" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="verified" stackId="c" name="Verified">
                  {categoryData.map((c) => (
                    <Cell key={c.name} fill={c.color} />
                  ))}
                </Bar>
                <Bar dataKey="unverified" stackId="c" name="Unverified" fill="#d8d2c6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={30} outerRadius={55} paddingAngle={1}>
                  {pieData.map((c) => (
                    <Cell key={c.name} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="text-[11px] text-granite-500">Coloured bars: verified; grey: unverified. Ring: verified share.</p>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold">District density</h3>
          <div className="flex gap-1.5">
            <button
              type="button"
              aria-pressed={state.layers.density}
              onClick={() => dispatch({ type: 'toggleLayer', layer: 'density' })}
              className={`chip ${state.layers.density ? 'border-laterite-600 bg-laterite-600 text-ivory-50' : 'hover:border-gold-500'}`}
            >
              Density map layer
            </button>
            <button
              type="button"
              aria-pressed={state.layers.districts}
              onClick={() => dispatch({ type: 'toggleLayer', layer: 'districts' })}
              className={`chip ${state.layers.districts ? 'border-granite-700 bg-granite-700 text-ivory-50' : 'hover:border-gold-500'}`}
            >
              District lines
            </button>
          </div>
        </div>
        <p className="mb-1 text-[11px] text-granite-500">
          {insights.districtBasis === 'verified' ? 'Verified' : 'All published'} sites per 1,000 km² of district area
          (area from the geoBoundaries ADM2 polygon).
        </p>
        <div className="scroll-thin max-h-64 overflow-y-auto rounded-lg border border-granite-200">
          <table className="w-full text-xs" aria-label="District density">
            <thead className="sticky top-0 bg-ivory-100 text-left text-granite-500">
              <tr>
                <th className="px-2 py-1 font-medium">District</th>
                <th className="px-2 py-1 text-right font-medium">Sites</th>
                <th className="px-2 py-1 text-right font-medium">km²</th>
                <th className="px-2 py-1 text-right font-medium">/1,000 km²</th>
              </tr>
            </thead>
            <tbody>
              {insights.byDistrict.map((d) => (
                <tr key={`${d.stateCode}-${d.district}`} className="border-t border-granite-100">
                  <td className="px-2 py-1">
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                      style={{ background: densityColor(d.densityPer1000Km2) }}
                      aria-hidden="true"
                    />
                    {d.district}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.count}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.areaKm2 ? Math.round(d.areaKm2).toLocaleString() : '-'}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.densityPer1000Km2 ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reports.map((r) =>
          r.districts?.note ? (
            <p key={r.stateCode} className="mt-1 text-[11px] text-granite-500">
              Data note: {r.districts.note}
            </p>
          ) : null,
        )}
      </section>

      {reports.map((r) =>
        r.asiCoverage ? (
          <section key={`asi-${r.stateCode}`} className="rounded-xl border border-gold-300 bg-gold-100/50 p-3">
            <h3 className="font-display text-lg font-semibold">ASI coverage gap</h3>
            <p className="text-sm text-granite-800">
              {r.asiCoverage.distinctCentralAsiIds} of {r.asiCoverage.asiPublishedCount} centrally protected monuments
              published by the{' '}
              <a href={r.asiCoverage.asiSource} target="_blank" rel="noopener noreferrer" className="underline">
                Archaeological Survey of India
              </a>{' '}
              (as of {r.asiCoverage.asiAsOf}) have a matching ASI ID here; {r.asiCoverage.missing} are not yet covered.
            </p>
            <p className="mt-1 text-[11px] text-granite-500">{r.asiCoverage.note}</p>
          </section>
        ) : null,
      )}
    </div>
  );
}
