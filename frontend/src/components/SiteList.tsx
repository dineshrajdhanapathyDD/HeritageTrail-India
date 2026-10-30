import { useEffect, useState } from 'react';
import type { HeritageFeature } from '@heritagetrail/shared';
import { useApp } from '../state/AppContext.tsx';
import { CATEGORY_LABELS } from '../domain/categories.ts';
import { iconKeyFor } from '../map/categoryIcons.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

const PAGE = 40;

export function SiteRow({
  feature,
  extra,
  onClick,
}: {
  feature: HeritageFeature;
  extra?: string;
  onClick: () => void;
}) {
  const { state } = useApp();
  const p = feature.properties;
  const selected = state.selectedId === p.id;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? 'true' : undefined}
        className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
          selected ? 'bg-gold-100' : 'hover:bg-ivory-200/70'
        }`}
      >
        <CategoryIcon icon={iconKeyFor(p)} size={22} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-granite-900">{p.name}</span>
          <span className="block truncate text-xs text-granite-500">
            {[p.district, CATEGORY_LABELS[p.category]].filter(Boolean).join(' · ')}
            {p.verificationStatus !== 'verified' && <span className="ml-1 text-laterite-600">· unverified</span>}
          </span>
        </span>
        {extra && <span className="shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-gold-700">{extra}</span>}
      </button>
    </li>
  );
}

export function SiteList() {
  const { visible, dispatch } = useApp();
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [visible]);
  const shown = visible.slice(0, limit);
  return (
    <section aria-label="Matching heritage sites">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-granite-900">Sites</h2>
        <span className="text-xs text-granite-500" data-testid="result-count">
          {visible.length} {visible.length === 1 ? 'site' : 'sites'}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="py-4 text-sm text-granite-500">No sites match. Try clearing filters or including unverified records.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {shown.map((f) => (
            <SiteRow key={f.properties.id} feature={f} onClick={() => dispatch({ type: 'select', id: f.properties.id })} />
          ))}
        </ul>
      )}
      {visible.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="mt-2 w-full rounded-lg border border-granite-200 py-1.5 text-xs font-medium text-granite-700 hover:border-gold-500"
        >
          Show more ({visible.length - limit} remaining)
        </button>
      )}
    </section>
  );
}
