import { useMemo } from 'react';
import { CATEGORIES } from '@heritagetrail/shared';
import { useApp } from '../state/AppContext.tsx';
import { CATEGORY_LABELS } from '../domain/categories.ts';
import { periodOptions } from '../domain/filters.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

const chipOn = 'border-laterite-600 bg-laterite-600 text-ivory-50';

export function FilterPanel() {
  const { state, dispatch, data } = useApp();
  const f = state.filters;
  const base = useMemo(
    () => data.features.filter((x) => f.includeUnverified || x.properties.verificationStatus === 'verified'),
    [data.features, f.includeUnverified],
  );
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of base) m.set(x.properties.category, (m.get(x.properties.category) ?? 0) + 1);
    return m;
  }, [base]);
  const periods = useMemo(() => periodOptions(base), [base]);
  const active = f.categories.length + f.periods.length + (f.unescoOnly ? 1 : 0) + (f.query ? 1 : 0);

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-granite-500">Heritage type</legend>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const on = f.categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => dispatch({ type: 'toggleCategory', category: c })}
                className={`chip ${on ? chipOn : 'hover:border-gold-500'}`}
              >
                <CategoryIcon icon={c} size={14} />
                {CATEGORY_LABELS[c]}
                <span className={on ? 'text-ivory-100/80' : 'text-granite-500'}>{categoryCounts.get(c) ?? 0}</span>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={f.unescoOnly}
            onClick={() => dispatch({ type: 'setUnescoOnly', value: !f.unescoOnly })}
            className={`chip ${f.unescoOnly ? 'border-indigo-heritage bg-indigo-heritage text-ivory-50' : 'hover:border-gold-500'}`}
          >
            <CategoryIcon icon="unesco" size={14} />
            UNESCO only
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-granite-500">Historical period</legend>
        <div className="flex flex-wrap gap-1.5">
          {periods.map((p) => {
            const on = f.periods.includes(p.bucket);
            return (
              <button
                key={p.bucket}
                type="button"
                aria-pressed={on}
                onClick={() => dispatch({ type: 'togglePeriod', bucket: p.bucket })}
                className={`chip ${on ? chipOn : 'hover:border-gold-500'}`}
              >
                {p.label}
                <span className={on ? 'text-ivory-100/80' : 'text-granite-500'}>{p.count}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-granite-500">Periods come only from dates stated in Wikidata or OpenStreetMap.</p>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-granite-700">
          <input
            type="checkbox"
            checked={f.includeUnverified}
            onChange={(e) => dispatch({ type: 'setIncludeUnverified', value: e.target.checked })}
            className="h-4 w-4 accent-laterite-600"
          />
          Include unverified records
        </label>
        {active > 0 && (
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'resetFilters' });
            }}
            className="text-xs font-medium text-laterite-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
