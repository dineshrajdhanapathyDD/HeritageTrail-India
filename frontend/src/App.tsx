import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { loadRuntimeConfig, type RuntimeConfig } from './config/runtimeConfig.ts';
import { loadSites, type LoadedData } from './data/loadSites.ts';
import { computeInsights, densityLookup } from './domain/insights.ts';
import type { LonLat } from './domain/nearby.ts';
import { MapView } from './map/MapView.tsx';
import { AppProvider, useApp } from './state/AppContext.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { DetailsPanel } from './components/DetailsPanel.tsx';
import { Legend } from './components/Legend.tsx';
import { Attribution } from './components/Attribution.tsx';
import { useNearbyResults } from './components/NearbyPanel.tsx';

const INDIA_BOUNDS: [number, number, number, number] = [68, 6, 97.5, 37.5];

function dataBounds(data: LoadedData): [number, number, number, number] {
  if (data.features.length === 0) return INDIA_BOUNDS;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const f of data.features) {
    const [lon, lat] = f.geometry.coordinates;
    w = Math.min(w, lon);
    s = Math.min(s, lat);
    e = Math.max(e, lon);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

function Brand() {
  const { data, config } = useApp();
  const coverage = data.states.map((s) => s.name).join(', ');
  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel pointer-events-auto absolute left-3 right-3 top-3 z-30 flex items-center gap-3 rounded-2xl px-4 py-2.5 md:right-auto md:left-4 md:top-4 md:w-[380px]"
    >
      <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden="true">
        <circle cx="16" cy="16" r="15" fill="#a3432a" />
        <path d="M16 6l1.4 2.2h-2.8zM13.8 9.6h4.4l.9 2.8h-6.2zM12.4 13.6h7.2l1 3.2h-9.2zM10.9 18h10.2l1.2 3.8H9.7z" fill="#f2cf73" />
        <rect x="8" y="23" width="16" height="2" fill="#f2cf73" />
      </svg>
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold leading-none tracking-tight text-granite-900">
          HeritageTrail <span className="text-laterite-600">India</span>
        </h1>
        <p className="truncate text-[11px] text-granite-500">
          Open heritage data · {coverage}
          {config.mode === 'local' && ' · local mode'}
        </p>
      </div>
    </motion.header>
  );
}

function Shell() {
  const { state, dispatch, data, config, visible, selected, byId } = useApp();
  const initialBounds = useMemo(() => dataBounds(data), [data]);
  const [mapCenter, setMapCenter] = useState<LonLat>([
    (initialBounds[0] + initialBounds[2]) / 2,
    (initialBounds[1] + initialBounds[3]) / 2,
  ]);
  const insights = useMemo(
    () => computeInsights(data.features, data.districts.features, { includeUnverified: state.filters.includeUnverified }),
    [data, state.filters.includeUnverified],
  );
  const densities = useMemo(() => densityLookup(insights), [insights]);
  const nearbyResults = useNearbyResults();
  const showNearby = state.panel === 'nearby' && state.nearby.center !== null;
  const nearby = useMemo(
    () =>
      showNearby && state.nearby.center
        ? {
            center: state.nearby.center,
            radiusKm: state.nearby.radiusKm,
            points: nearbyResults.map((r) => r.feature.geometry.coordinates),
          }
        : null,
    [showNearby, state.nearby.center, state.nearby.radiusKm, nearbyResults],
  );
  const routeStops = useMemo(
    () => state.route.stopIds.map((id) => byId.get(id)?.geometry.coordinates).filter((c): c is LonLat => c !== undefined),
    [state.route.stopIds, byId],
  );
  // Keep a selected site on the map even when the filters would hide it.
  // Nearby results are drawn too, since the nearby list ignores the text search.
  const mapFeatures = useMemo(() => {
    const extra = [...(showNearby ? nearbyResults.map((r) => r.feature) : []), ...(selected ? [selected] : [])];
    if (extra.length === 0) return visible;
    const ids = new Set(visible.map((f) => f.properties.id));
    const out = [...visible];
    for (const f of extra) if (!ids.has(f.properties.id)) (ids.add(f.properties.id), out.push(f));
    return out;
  }, [visible, selected, showNearby, nearbyResults]);
  const onSelect = useCallback((id: string) => dispatch({ type: 'select', id }), [dispatch]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ivory-100">
      <MapView
        config={config}
        features={mapFeatures}
        districts={data.districts}
        stateBoundaries={data.stateBoundaries}
        densities={densities}
        selected={selected}
        nearby={nearby}
        route={state.route.result?.geometry ?? null}
        routeStops={state.panel === 'route' || state.route.result ? routeStops : []}
        layers={state.layers}
        initialBounds={initialBounds}
        onSelect={onSelect}
        onMoveEnd={setMapCenter}
      />
      <Brand />
      <Sidebar insights={insights} mapCenter={mapCenter} />
      <AnimatePresence>{selected && <DetailsPanel key={selected.properties.id} feature={selected} />}</AnimatePresence>
      <Legend densityOn={state.layers.density} />
      <Attribution />
      {data.errors.length > 0 && (
        <div role="alert" className="absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-laterite-700 px-4 py-1 text-xs text-ivory-50">
          Some data could not be loaded: {data.errors.join('; ')}
        </div>
      )}
    </div>
  );
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: RuntimeConfig; data: LoadedData };

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadRuntimeConfig(), loadSites()])
      .then(([config, data]) => !cancelled && setLoad({ status: 'ready', config, data }))
      .catch((err: unknown) => {
        console.error('data load failed', err);
        if (!cancelled) setLoad({ status: 'error', message: 'The heritage data could not be loaded.' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.status !== 'ready') {
    return (
      <div className="grid h-dvh place-items-center bg-ivory-100">
        <div className="text-center">
          <p className="font-display text-3xl font-semibold text-granite-900">
            HeritageTrail <span className="text-laterite-600">India</span>
          </p>
          <div className="ht-divider mx-auto my-3 w-40" />
          <p className="text-sm text-granite-600" role={load.status === 'error' ? 'alert' : 'status'}>
            {load.status === 'error' ? load.message : 'Loading heritage sites…'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <AppProvider config={load.config} data={load.data}>
      <Shell />
    </AppProvider>
  );
}
