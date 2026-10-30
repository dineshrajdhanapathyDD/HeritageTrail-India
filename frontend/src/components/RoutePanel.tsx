import { useApp } from '../state/AppContext.tsx';
import { formatDuration, MAX_ROUTE_STOPS } from '../domain/routes.ts';
import { calculateRoute, describeLocationError } from '../services/location.ts';
import { iconKeyFor } from '../map/categoryIcons.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

export const LOCAL_ROUTING_MESSAGE = 'Routing needs an Amazon Location API key (available after deploy)';

export function RoutePanel() {
  const { state, dispatch, config, byId, selected } = useApp();
  const r = state.route;
  const stops = r.stopIds.map((id) => byId.get(id)).filter((f) => f !== undefined);
  const local = config.mode !== 'aws';
  const canAddSelected = selected && !r.stopIds.includes(selected.properties.id) && r.stopIds.length < MAX_ROUTE_STOPS;

  const calculate = async () => {
    dispatch({ type: 'routeLoading' });
    try {
      const result = await calculateRoute(
        config,
        stops.map((f) => f.geometry.coordinates),
      );
      dispatch({ type: 'routeSuccess', result });
    } catch (err) {
      dispatch({ type: 'routeError', error: describeLocationError(err) });
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-display text-xl font-semibold">Heritage circuit</h2>
        <p className="text-xs text-granite-600">
          Pick 2 to {MAX_ROUTE_STOPS} sites in visiting order. Driving routes come from Amazon Location Service.
        </p>
      </div>

      {local && (
        <p role="status" className="rounded-xl border border-gold-300 bg-gold-100/70 p-3 text-sm text-granite-800">
          {LOCAL_ROUTING_MESSAGE}. You can still build and reorder the circuit here.
        </p>
      )}

      {canAddSelected && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'addStop', id: selected.properties.id })}
          className="chip hover:border-gold-500"
        >
          + Add selected: {selected.properties.name}
        </button>
      )}

      {stops.length === 0 ? (
        <p className="text-sm text-granite-600">
          No stops yet. Open a site and choose <em>Add to route</em>, or build a circuit from the nearby explorer.
        </p>
      ) : (
        <ol className="space-y-1" aria-label="Route stops">
          {stops.map((f, i) => (
            <li key={f.properties.id} className="flex items-center gap-2 rounded-lg bg-ivory-50/80 px-2 py-1.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-laterite-600 text-[10px] font-bold text-ivory-50">
                {i + 1}
              </span>
              <CategoryIcon icon={iconKeyFor(f.properties)} size={18} />
              <button
                type="button"
                onClick={() => dispatch({ type: 'select', id: f.properties.id })}
                className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
              >
                {f.properties.name}
              </button>
              <button
                type="button"
                aria-label={`Move ${f.properties.name} up`}
                disabled={i === 0}
                onClick={() => dispatch({ type: 'moveStop', id: f.properties.id, delta: -1 })}
                className="px-1 text-granite-500 hover:text-granite-900 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${f.properties.name} down`}
                disabled={i === stops.length - 1}
                onClick={() => dispatch({ type: 'moveStop', id: f.properties.id, delta: 1 })}
                className="px-1 text-granite-500 hover:text-granite-900 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove ${f.properties.name}`}
                onClick={() => dispatch({ type: 'removeStop', id: f.properties.id })}
                className="px-1 text-laterite-600 hover:text-laterite-900"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={calculate}
          disabled={local || stops.length < 2 || r.status === 'loading'}
          className="rounded-full bg-laterite-600 px-4 py-2 text-sm font-medium text-ivory-50 hover:bg-laterite-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {r.status === 'loading' ? 'Calculating…' : 'Calculate route'}
        </button>
        {stops.length > 0 && (
          <button type="button" onClick={() => dispatch({ type: 'clearStops' })} className="text-xs text-granite-600 hover:underline">
            Clear
          </button>
        )}
      </div>

      {r.status === 'error' && r.error && (
        <p role="alert" className="text-sm text-laterite-700">
          {r.error}
        </p>
      )}
      {r.status === 'done' && r.result && (
        <div className="rounded-xl border border-laterite-300/60 bg-laterite-50 p-3" data-testid="route-result">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-laterite-700">Driving route</p>
          <p className="font-display text-3xl font-semibold text-granite-900">
            {r.result.distanceMeters !== null ? `${(r.result.distanceMeters / 1000).toFixed(1)} km` : 'distance unknown'}
          </p>
          <p className="text-xs text-granite-600">
            {r.result.durationSeconds !== null && <>about {formatDuration(r.result.durationSeconds)} · </>}
            {r.result.legCount} {r.result.legCount === 1 ? 'leg' : 'legs'} ·{' '}
            {r.result.geometry.geometry.coordinates.length.toLocaleString()} route points
          </p>
          <p className="mt-1 text-[10px] text-granite-500">Route by Amazon Location Service.</p>
        </div>
      )}
    </div>
  );
}
