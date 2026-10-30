import { motion } from 'framer-motion';
import { useApp } from '../state/AppContext.tsx';
import type { Panel } from '../state/reducer.ts';
import type { Insights } from '../domain/insights.ts';
import type { LonLat } from '../domain/nearby.ts';
import { SearchBar } from './SearchBar.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { SiteList } from './SiteList.tsx';
import { NearbyPanel } from './NearbyPanel.tsx';
import { RoutePanel } from './RoutePanel.tsx';
import { InsightsDashboard } from './InsightsDashboard.tsx';

const TABS: { id: Panel; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'route', label: 'Route' },
  { id: 'insights', label: 'Insights' },
];

export function Sidebar({ insights, mapCenter }: { insights: Insights; mapCenter: LonLat }) {
  const { state, dispatch } = useApp();
  const wide = state.panel === 'insights';
  return (
    <motion.aside
      layout
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className={`panel pointer-events-auto fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl md:absolute md:inset-x-auto md:bottom-10 md:left-4 md:top-[92px] md:rounded-2xl ${
        state.sheetOpen ? 'max-h-[56dvh]' : 'max-h-[64px]'
      } md:max-h-none ${wide ? 'md:w-[560px]' : 'md:w-[380px]'}`}
      id="explore-panel"
      aria-label="Explore heritage sites"
    >
      <button
        type="button"
        onClick={() => dispatch({ type: 'setSheetOpen', open: !state.sheetOpen })}
        className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-granite-300 md:hidden"
        aria-label={state.sheetOpen ? 'Collapse panel' : 'Expand panel'}
      />
      <nav className="shrink-0 px-3 pt-2 md:pt-3" aria-label="Panels">
        <div role="tablist" className="grid grid-cols-4 gap-1 rounded-xl bg-ivory-200/70 p-1">
          {TABS.map((t) => {
            const on = state.panel === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={on}
                onClick={() => dispatch({ type: 'setPanel', panel: t.id })}
                className={`relative rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                  on ? 'text-ivory-50' : 'text-granite-600 hover:text-granite-900'
                }`}
              >
                {on && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-lg bg-laterite-600"
                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                  />
                )}
                <span className="relative">
                  {t.label}
                  {t.id === 'route' && state.route.stopIds.length > 0 && ` (${state.route.stopIds.length})`}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3" role="tabpanel">
        {state.panel === 'explore' && (
          <div className="space-y-4">
            <SearchBar />
            <FilterPanel />
            <div className="ht-divider" />
            <SiteList />
          </div>
        )}
        {state.panel === 'nearby' && <NearbyPanel mapCenter={mapCenter} />}
        {state.panel === 'route' && <RoutePanel />}
        {state.panel === 'insights' && <InsightsDashboard insights={insights} />}
      </div>
    </motion.aside>
  );
}
