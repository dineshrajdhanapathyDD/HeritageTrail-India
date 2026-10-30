import { useApp } from '../state/AppContext.tsx';

export function SearchBar() {
  const { state, dispatch } = useApp();
  return (
    <div className="relative">
      <label htmlFor="site-search" className="sr-only">
        Search heritage sites by name, state, district or category
      </label>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-granite-500"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="M13 13l4 4" strokeLinecap="round" />
      </svg>
      <input
        id="site-search"
        type="search"
        value={state.filters.query}
        onChange={(e) => dispatch({ type: 'setQuery', query: e.target.value.slice(0, 120) })}
        placeholder="Search name, district, state or category"
        autoComplete="off"
        className="w-full rounded-xl border border-granite-200 bg-ivory-50 py-2.5 pl-9 pr-3 text-sm text-granite-900 placeholder:text-granite-500 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-300/60"
      />
    </div>
  );
}
