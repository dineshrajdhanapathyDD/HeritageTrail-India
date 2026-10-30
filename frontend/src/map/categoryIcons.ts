import type { Category, HeritageSiteProperties } from '@heritagetrail/shared';

export type IconKey = Category | 'unesco';

export const ICON_KEYS: IconKey[] = ['temple', 'fort', 'monument', 'museum', 'archaeological-site', 'other', 'unesco'];

/** Heritage palette: temple gold, laterite red, granite, peacock teal, ochre, slate, and UNESCO indigo. */
export const ICON_COLORS: Record<IconKey, string> = {
  temple: '#b8862b',
  fort: '#a3432a',
  monument: '#4d4943',
  museum: '#2b5f6b',
  'archaeological-site': '#86643a',
  other: '#77706a',
  unesco: '#243f73',
};

export const ICON_LABELS: Record<IconKey, string> = {
  temple: 'Temple',
  fort: 'Fort',
  monument: 'Monument',
  museum: 'Museum',
  'archaeological-site': 'Archaeological site',
  other: 'Other heritage',
  unesco: 'UNESCO World Heritage (incl. tentative)',
};

/** White glyphs drawn on a 24x24 grid, centred in the marker. */
const GLYPHS: Record<IconKey, string> = {
  // Gopuram: stepped tower with finial
  temple:
    '<path d="M12 4.5l1 1.6h-2zM10.2 7h3.6l.7 2.2H9.5zM9.1 10h5.8l.8 2.6H8.3zM7.9 13.4h8.2l.9 3.1H7z" fill="#fff"/><rect x="6.4" y="17.2" width="11.2" height="1.6" fill="#fff"/>',
  // Fort: crenellated wall with gate
  fort:
    '<path d="M6 9h2v1.6h1.6V9h1.6v1.6h1.6V9h1.6v1.6h1.6V9H18v9.5H6z" fill="#fff"/><path d="M10.5 18.5v-3a1.5 1.5 0 0 1 3 0v3z" fill="currentColor"/>',
  // Monument: obelisk on plinth
  monument: '<path d="M12 4.6l1.6 2.2.8 9.4H9.6l.8-9.4z" fill="#fff"/><rect x="8" y="16.6" width="8" height="2" fill="#fff"/>',
  // Museum: pediment and columns
  museum:
    '<path d="M12 5l7 3.4H5z" fill="#fff"/><rect x="6.2" y="9.4" width="1.8" height="6.8" fill="#fff"/><rect x="9.4" y="9.4" width="1.8" height="6.8" fill="#fff"/><rect x="12.8" y="9.4" width="1.8" height="6.8" fill="#fff"/><rect x="16" y="9.4" width="1.8" height="6.8" fill="#fff"/><rect x="5" y="16.8" width="14" height="1.8" fill="#fff"/>',
  // Archaeological site: urn / burial jar
  'archaeological-site':
    '<path d="M9.4 5.6h5.2v1.4l-.9.8c2.6 1.3 3.9 3.4 3.9 6 0 2.8-2 4.6-5.6 4.6s-5.6-1.8-5.6-4.6c0-2.6 1.3-4.7 3.9-6l-.9-.8z" fill="#fff"/>',
  other: '<circle cx="12" cy="12" r="3.6" fill="#fff"/>',
  // UNESCO: eight-point star
  unesco:
    '<path d="M12 4.4l1.9 4 4.3.4-3.2 2.9 1 4.3L12 13.8l-4 2.2 1-4.3-3.2-2.9 4.3-.4z" fill="#f2cf73"/><rect x="7" y="17.4" width="10" height="1.4" fill="#f2cf73"/>',
};

export function iconKeyFor(p: Pick<HeritageSiteProperties, 'category' | 'unesco'>): IconKey {
  return p.unesco ? 'unesco' : p.category;
}

/** Round badge with a light ring; UNESCO gets a gold ring. Size in CSS pixels. */
export function iconSvg(key: IconKey, size = 28): string {
  const color = ICON_COLORS[key];
  const ring = key === 'unesco' ? '#e0b44c' : '#fdfaf3';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" color="${color}">` +
    `<circle cx="12" cy="12" r="11" fill="${color}" stroke="${ring}" stroke-width="1.6"/>` +
    GLYPHS[key] +
    '</svg>'
  );
}

export function iconDataUrl(key: IconKey, size = 28): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(key, size))}`;
}

/** Loads every icon as an HTMLImageElement at 2x resolution for map.addImage(..., { pixelRatio: 2 }). */
export async function loadIconImages(size = 28): Promise<Record<IconKey, HTMLImageElement>> {
  const entries = await Promise.all(
    ICON_KEYS.map(
      (key) =>
        new Promise<[IconKey, HTMLImageElement]>((resolve, reject) => {
          const img = new Image(size * 2, size * 2);
          img.onload = () => resolve([key, img]);
          img.onerror = () => reject(new Error(`icon ${key} failed to load`));
          img.src = iconDataUrl(key, size * 2);
        }),
    ),
  );
  return Object.fromEntries(entries) as Record<IconKey, HTMLImageElement>;
}
