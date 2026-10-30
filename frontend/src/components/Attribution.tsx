import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '../state/AppContext.tsx';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * Data attribution. Text and licences come from the loaded GeoJSON metadata (pipeline output), so new sources or
 * states show up without code changes.
 */
export function Attribution() {
  const { data, config } = useApp();
  const [open, setOpen] = useState(false);
  const sources = useMemo(() => {
    const m = new Map<string, { name: string; url: string; license: string; licenseUrl: string }>();
    for (const c of data.collections) for (const s of c.sources) if (!m.has(s.id)) m.set(s.id, s);
    return [...m.values()];
  }, [data.collections]);
  const attribution = useMemo(() => [...new Set(data.collections.flatMap((c) => c.attribution))], [data.collections]);
  const retrieved = data.collections.map((c) => `${c.state}: ${c.dataRetrievedAt.slice(0, 10)}`).join('; ');

  return (
    <>
      <div className="pointer-events-auto absolute bottom-1 left-1 z-10 hidden max-w-[calc(100%-260px)] items-center gap-2 rounded-md bg-ivory-50/85 px-2 py-0.5 text-[10px] text-granite-700 md:flex">
        <span className="truncate">
          Data: <a href="https://www.openstreetmap.org/copyright" {...ext} className="underline">© OpenStreetMap contributors</a>{' '}
          (ODbL) · Wikidata (CC0) · geoBoundaries (CC BY / ODbL) · Images: Wikimedia Commons, per-image licence
          {config.mode === 'aws' ? ' · Map: Amazon Location Service' : ' · Local basemap'}
        </span>
        <button type="button" onClick={() => setOpen(true)} className="shrink-0 font-semibold text-laterite-700 underline">
          Sources & licences
        </button>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="panel pointer-events-auto absolute right-3 top-[68px] z-10 rounded-full px-2.5 py-1 text-[11px] font-medium text-granite-700 md:hidden"
      >
        Sources
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-granite-900/40 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-label="Data sources and licences"
              className="panel scroll-thin max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-2xl p-5"
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <h2 className="font-display text-2xl font-semibold">Data sources & licences</h2>
                <button type="button" onClick={() => setOpen(false)} className="text-sm text-granite-500 hover:text-granite-900">
                  Close
                </button>
              </div>
              <div className="ht-divider my-2" />
              <ul className="space-y-2 text-sm">
                {sources.map((s) => (
                  <li key={s.name}>
                    <a href={s.url} {...ext} className="font-medium text-laterite-700 underline">
                      {s.name}
                    </a>{' '}
                    <a href={s.licenseUrl} {...ext} className="text-xs text-granite-600 underline">
                      {s.license}
                    </a>
                  </li>
                ))}
                {data.boundarySources.map((b) =>
                  b.name && !sources.some((s) => s.name === b.name) ? (
                    <li key={b.name}>
                      <span className="font-medium">{b.name}</span>{' '}
                      {b.licenseUrl && (
                        <a href={b.licenseUrl} {...ext} className="text-xs text-granite-600 underline">
                          {b.license}
                        </a>
                      )}
                    </li>
                  ) : null,
                )}
              </ul>
              <h3 className="mt-4 font-display text-lg font-semibold">Required attribution</h3>
              <ul className="list-disc space-y-1 pl-5 text-xs text-granite-700">
                {attribution.map((a) => (
                  <li key={a}>{a}</li>
                ))}
                <li>
                  <a href="https://www.openstreetmap.org/copyright" {...ext} className="underline">
                    OpenStreetMap copyright and licence
                  </a>
                </li>
                {config.mode === 'aws' ? (
                  <li>Basemap, place search and routing: Amazon Location Service; provider credits appear in the map corner.</li>
                ) : (
                  <li>Local basemap drawn from geoBoundaries state polygons; no map tiles are loaded.</li>
                )}
              </ul>
              <p className="mt-3 text-xs text-granite-500">
                Data retrieved {retrieved}. Each site lists its own sources and licences in the details panel. Images are
                linked from Wikimedia Commons, not copied, and keep their own licences.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
