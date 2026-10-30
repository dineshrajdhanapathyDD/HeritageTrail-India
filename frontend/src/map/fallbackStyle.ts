import type { StyleSpecification } from 'maplibre-gl';

/**
 * Local basemap used when no Amazon Location API key is configured (design decision 11): a background colour and the
 * geoBoundaries ADM1 state polygons served from /data/. No external tiles, sprites or glyphs are requested.
 */
export function fallbackStyle(indiaStatesUrl: string): StyleSpecification {
  return {
    version: 8,
    name: 'HeritageTrail local basemap',
    sources: {
      'india-states-base': {
        type: 'geojson',
        data: indiaStatesUrl,
        attribution: 'Boundaries: geoBoundaries (gbOpen IND ADM1), source DataMeet India community, CC BY',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#dfe6e3' } },
      {
        id: 'india-states-land',
        type: 'fill',
        source: 'india-states-base',
        paint: { 'fill-color': '#f6efdf', 'fill-opacity': 1 },
      },
      {
        id: 'india-states-outline',
        type: 'line',
        source: 'india-states-base',
        paint: { 'line-color': '#b9ab8e', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 8, 1.2] },
      },
    ],
  };
}
