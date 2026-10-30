import { useState, type FormEvent } from 'react';
import { useApp } from '../state/AppContext.tsx';
import { describeLocationError, geocodePlace, type PlaceResult } from '../services/location.ts';
import type { LonLat } from '../domain/nearby.ts';

/** Amazon Location geo-places Geocode to centre the nearby explorer. Hidden in local mode (no API key). */
export function PlaceSearch({ bias }: { bias: LonLat }) {
  const { config, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (config.mode !== 'aws') return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setError(null);
    try {
      setResults(await geocodePlace(config, query, bias));
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(describeLocationError(err));
    }
  };

  return (
    <div>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="place-search" className="sr-only">
          Find a town or place in India
        </label>
        <input
          id="place-search"
          value={query}
          onChange={(e) => setQuery(e.target.value.slice(0, 200))}
          placeholder="Find a town or place"
          className="min-w-0 flex-1 rounded-lg border border-granite-200 bg-ivory-50 px-3 py-1.5 text-sm focus:border-gold-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!query.trim() || status === 'loading'}
          className="rounded-lg bg-granite-800 px-3 py-1.5 text-xs font-medium text-ivory-50 disabled:opacity-50"
        >
          {status === 'loading' ? '…' : 'Find'}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-laterite-700">{error}</p>}
      {results.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {results.map((r) => (
            <li key={`${r.title}-${r.position.join(',')}`}>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'setNearbyCenter', center: r.position, label: r.title, siteId: null });
                  setResults([]);
                }}
                className="w-full rounded px-2 py-1 text-left text-xs text-granite-700 hover:bg-ivory-200"
              >
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-granite-500">Place search by Amazon Location Service.</p>
    </div>
  );
}
