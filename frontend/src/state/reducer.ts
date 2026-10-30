import type { Category } from '@heritagetrail/shared';
import { DEFAULT_FILTERS, toggleValue, type FilterState } from '../domain/filters.ts';
import { clampRadius, DEFAULT_RADIUS_KM, type LonLat } from '../domain/nearby.ts';
import { MAX_ROUTE_STOPS, type RouteResult } from '../domain/routes.ts';

export type Panel = 'explore' | 'nearby' | 'route' | 'insights';

export interface NearbyState {
  center: LonLat | null;
  label: string | null;
  /** Set when the centre is a heritage site, so it is excluded from its own results. */
  siteId: string | null;
  radiusKm: number;
}

export interface RouteState {
  stopIds: string[];
  status: 'idle' | 'loading' | 'done' | 'error';
  result: RouteResult | null;
  error: string | null;
}

export interface LayerState {
  districts: boolean;
  density: boolean;
}

export interface AppState {
  filters: FilterState;
  selectedId: string | null;
  panel: Panel;
  nearby: NearbyState;
  route: RouteState;
  layers: LayerState;
  /** Mobile bottom sheet expanded. */
  sheetOpen: boolean;
}

export const initialState: AppState = {
  filters: DEFAULT_FILTERS,
  selectedId: null,
  panel: 'explore',
  nearby: { center: null, label: null, siteId: null, radiusKm: DEFAULT_RADIUS_KM },
  route: { stopIds: [], status: 'idle', result: null, error: null },
  layers: { districts: true, density: false },
  sheetOpen: true,
};

export type Action =
  | { type: 'setQuery'; query: string }
  | { type: 'toggleCategory'; category: Category }
  | { type: 'togglePeriod'; bucket: string }
  | { type: 'setUnescoOnly'; value: boolean }
  | { type: 'setIncludeUnverified'; value: boolean }
  | { type: 'resetFilters' }
  | { type: 'select'; id: string | null }
  | { type: 'setPanel'; panel: Panel }
  | { type: 'setNearbyCenter'; center: LonLat; label: string; siteId: string | null }
  | { type: 'setRadius'; radiusKm: number }
  | { type: 'addStop'; id: string }
  | { type: 'removeStop'; id: string }
  | { type: 'moveStop'; id: string; delta: -1 | 1 }
  | { type: 'clearStops' }
  | { type: 'routeLoading' }
  | { type: 'routeSuccess'; result: RouteResult }
  | { type: 'routeError'; error: string }
  | { type: 'toggleLayer'; layer: keyof LayerState }
  | { type: 'setSheetOpen'; open: boolean };

const resetRoute = (stopIds: string[]): RouteState => ({ stopIds, status: 'idle', result: null, error: null });

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setQuery':
      return { ...state, filters: { ...state.filters, query: action.query } };
    case 'toggleCategory':
      return {
        ...state,
        filters: { ...state.filters, categories: toggleValue(state.filters.categories, action.category) },
      };
    case 'togglePeriod':
      return { ...state, filters: { ...state.filters, periods: toggleValue(state.filters.periods, action.bucket) } };
    case 'setUnescoOnly':
      return { ...state, filters: { ...state.filters, unescoOnly: action.value } };
    case 'setIncludeUnverified':
      return { ...state, filters: { ...state.filters, includeUnverified: action.value } };
    case 'resetFilters':
      return { ...state, filters: { ...DEFAULT_FILTERS, includeUnverified: state.filters.includeUnverified } };
    case 'select':
      return { ...state, selectedId: action.id, sheetOpen: action.id ? true : state.sheetOpen };
    case 'setPanel':
      return { ...state, panel: action.panel, sheetOpen: true };
    case 'setNearbyCenter':
      return {
        ...state,
        panel: 'nearby',
        nearby: { ...state.nearby, center: action.center, label: action.label, siteId: action.siteId },
      };
    case 'setRadius':
      return { ...state, nearby: { ...state.nearby, radiusKm: clampRadius(action.radiusKm) } };
    case 'addStop':
      if (state.route.stopIds.includes(action.id) || state.route.stopIds.length >= MAX_ROUTE_STOPS) return state;
      return { ...state, route: resetRoute([...state.route.stopIds, action.id]) };
    case 'removeStop':
      return { ...state, route: resetRoute(state.route.stopIds.filter((s) => s !== action.id)) };
    case 'moveStop': {
      const ids = [...state.route.stopIds];
      const i = ids.indexOf(action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= ids.length) return state;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      return { ...state, route: resetRoute(ids) };
    }
    case 'clearStops':
      return { ...state, route: resetRoute([]) };
    case 'routeLoading':
      return { ...state, route: { ...state.route, status: 'loading', error: null } };
    case 'routeSuccess':
      return { ...state, route: { ...state.route, status: 'done', result: action.result, error: null } };
    case 'routeError':
      return { ...state, route: { ...state.route, status: 'error', result: null, error: action.error } };
    case 'toggleLayer':
      return { ...state, layers: { ...state.layers, [action.layer]: !state.layers[action.layer] } };
    case 'setSheetOpen':
      return { ...state, sheetOpen: action.open };
    default:
      return state;
  }
}
