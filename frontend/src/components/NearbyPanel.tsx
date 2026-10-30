import { useMemo } from 'react';
import { useApp } from '../state/AppContext.tsx';
import { filterSites } from '../domain/filters.ts';
import { findNearby, formatKm, RADIUS_MAX_KM, RADIUS_MIN_KM, type LonLat, type NearbyResult } from '../domain/nearby.ts';
import { MAX_ROUTE_STOPS } from '../domain/routes.ts';
import { PlaceSearch } from './PlaceSearch.tsx';
import { SiteRow } from './SiteList.tsx';

/** Nearby uses the type, period, UNESCO and verification filters, but not the free-text search. */
export function useNearbyResults(): NearbyResult[] {
  const { state, data } = useApp();
  const { center, radiusKm, siteId } = state.nearby;
  const filters = state.filters;
  const pool = useMemo(() => filterSites(data.features, { ...filters, query: '' }), [data.features, filters]);
  return useMemo(
    () => (center ? findNearby(pool, center, radiusKm, siteId ?? undefined) : []),
    [pool, center, radiusKm, siteId],
  );
}

export function NearbyPanel({ mapCenter }: { mapCenter: LonLat }) {
  const { state, dispatch, selected } = useApp();
  const nb = state.nearby;
  const results = useNearbyResults();
  const freeSlots = MAX_ROUTE_STOPS - state.route.stopIds.length;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-display text-xl font-semibold">Nearby explorer</h2>
        <p className="text-xs text-granite-600">
          Straight-line (great-circle) distances from the chosen centre. Type, period and verification filters apply;
          the text search does not.
        </p>
      </div>

      <div className="rounded-xl border border-granite-200 bg-ivory-50/70 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-granite-500">Centre</p>
        <p className="font-medium text-granite-900" data-testid="nearby-centre">
          {nb.label ?? 'Not set'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {selected && selected.properties.id !== nb.siteId && (
            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: 'setNearbyCenter',
                  center: selected.geometry.coordinates,
                  label: selected.properties.name,
                  siteId: selected.properties.id,
                })
              }
              className="chip hover:border-gold-500"
            >
              Use selected: {selected.properties.name}
            </button>
          )}
          <button
            type="button"
            onClick={() => dispatch({ type: 'setNearbyCenter', center: mapCenter, label: 'Map centre', siteId: null })}
            className="chip hover:border-gold-500"
          >
            Use map centre
          </button>
        </div>
        <div className="mt-2">
          <PlaceSearch bias={nb.center ?? mapCenter} />
        </div>
      </div>

      <div>
        <label htmlFor="nearby-radius" className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Radius</span>
          <span className="tabular-nums text-granite-700" data-testid="nearby-radius-value">
            {nb.radiusKm} km
          </span>
        </label>
        <input
          id="nearby-radius"
          type="range"
          min={RADIUS_MIN_KM}
          max={RADIUS_MAX_KM}
          step={1}
          value={nb.radiusKm}
          onChange={(e) => dispatch({ type: 'setRadius', radiusKm: Number(e.target.value) })}
          className="ht-range w-full"
        />
      </div>

      {nb.center ? (
        <section aria-label="Nearby sites">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="font-display text-lg font-semibold">Within {nb.radiusKm} km</h3>
            <span className="text-xs text-granite-500" data-testid="nearby-count">
              {results.length} {results.length === 1 ? 'site' : 'sites'}
            </span>
          </div>
          {results.length > 0 && freeSlots > 0 && (
            <button
              type="button"
              onClick={() => {
                const ids = results.slice(0, Math.min(5, freeSlots)).map((r) => r.feature.properties.id);
                if (nb.siteId && !state.route.stopIds.includes(nb.siteId)) dispatch({ type: 'addStop', id: nb.siteId });
                for (const id of ids) dispatch({ type: 'addStop', id });
                dispatch({ type: 'setPanel', panel: 'route' });
              }}
              className="mb-2 text-xs font-medium text-laterite-700 hover:underline"
            >
              Build a circuit from the nearest {Math.min(5, results.length, freeSlots)}
            </button>
          )}
          <ul className="-mx-2 space-y-0.5">
            {results.slice(0, 60).map((r) => (
              <SiteRow
                key={r.feature.properties.id}
                feature={r.feature}
                extra={formatKm(r.distanceKm)}
                onClick={() => dispatch({ type: 'select', id: r.feature.properties.id })}
              />
            ))}
          </ul>
          {results.length > 60 && <p className="mt-1 text-xs text-granite-500">Showing the nearest 60.</p>}
        </section>
      ) : (
        <p className="text-sm text-granite-600">
          Select a site and choose <em>Explore nearby</em>, or use the map centre to start.
        </p>
      )}
    </div>
  );
}
