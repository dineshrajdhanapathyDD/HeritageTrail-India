import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import type { HeritageFeature } from '@heritagetrail/shared';
import type { RuntimeConfig } from '../config/runtimeConfig.ts';
import type { LoadedData } from '../data/loadSites.ts';
import { filterSites } from '../domain/filters.ts';
import { initialState, reducer, type Action, type AppState } from './reducer.ts';

export interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
  config: RuntimeConfig;
  data: LoadedData;
  /** Features passing the current search and filters (what the map and list show). */
  visible: HeritageFeature[];
  byId: Map<string, HeritageFeature>;
  selected: HeritageFeature | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  config,
  data,
  initial,
  children,
}: {
  config: RuntimeConfig;
  data: LoadedData;
  initial?: Partial<AppState>;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, ...initial });
  const byId = useMemo(() => new Map(data.features.map((f) => [f.properties.id, f])), [data.features]);
  const visible = useMemo(() => filterSites(data.features, state.filters), [data.features, state.filters]);
  const selected = state.selectedId ? (byId.get(state.selectedId) ?? null) : null;
  const value = useMemo(
    () => ({ state, dispatch, config, data, visible, byId, selected }),
    [state, config, data, visible, byId, selected],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
