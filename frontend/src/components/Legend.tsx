import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ICON_KEYS, ICON_LABELS } from '../map/categoryIcons.ts';
import { DENSITY_COLORS, DENSITY_STEPS } from '../map/density.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

export function Legend({ densityOn }: { densityOn: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="pointer-events-auto absolute bottom-40 right-3 z-10 hidden md:block">
      <div className="panel w-56 rounded-xl">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between px-3 py-2 text-left"
        >
          <span className="font-display text-base font-semibold">Legend</span>
          <span className="text-xs text-granite-500">{open ? 'hide' : 'show'}</span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <ul className="space-y-1 px-3 pb-2 text-xs text-granite-700">
                {ICON_KEYS.map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <CategoryIcon icon={k} size={18} />
                    {ICON_LABELS[k]}
                  </li>
                ))}
                <li className="flex items-center gap-2">
                  <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[conic-gradient(#b8862b_0deg_200deg,#a3432a_200deg_300deg,#2b5f6b_300deg_360deg)] p-[3px]">
                    <span className="h-full w-full rounded-full bg-ivory-50" />
                  </span>
                  Cluster (ring = category mix)
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-0.5 w-[18px] bg-laterite-600" /> Route
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-3 w-[18px] rounded-sm border border-dashed border-gold-600 bg-gold-600/10" /> Nearby radius
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-0 w-[18px] border-t border-dashed border-granite-500" /> District boundary
                </li>
              </ul>
              {densityOn && (
                <div className="border-t border-granite-200 px-3 py-2">
                  <p className="mb-1 text-[11px] font-semibold text-granite-600">Sites per 1,000 km²</p>
                  <div className="flex">
                    {DENSITY_COLORS.map((c, i) => (
                      <div key={c} className="flex-1 text-center text-[10px] text-granite-600">
                        <div className="h-2.5" style={{ background: c }} />
                        {DENSITY_STEPS[i]}
                        {i === DENSITY_COLORS.length - 1 ? '+' : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
