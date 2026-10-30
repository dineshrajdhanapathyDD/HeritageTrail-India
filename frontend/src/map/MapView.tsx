import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import circle from '@turf/circle';
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from 'geojson';
import { normalizeName, type HeritageFeature } from '@heritagetrail/shared';
import type { RuntimeConfig } from '../config/runtimeConfig.ts';
import { DATA_BASE, INDIA_STATES_FILE, type DistrictProps } from '../data/loadSites.ts';
import type { LonLat } from '../domain/nearby.ts';
import { ICON_COLORS, ICON_KEYS, iconKeyFor, loadIconImages, type IconKey } from './categoryIcons.ts';
import { resolveMapStyle } from './mapStyle.ts';
import { DENSITY_COLORS, DENSITY_STEPS } from './density.ts';

// maplibre-gl v6 is ESM with a separate worker file; point it at the copy Vite emits.
setWorkerUrl(workerUrl);

export interface MapViewProps {
  config: RuntimeConfig;
  features: HeritageFeature[];
  districts: FeatureCollection<Polygon | MultiPolygon, DistrictProps>;
  stateBoundaries: FeatureCollection;
  densities: Map<string, number>;
  selected: HeritageFeature | null;
  /** Nearby circle and the coordinates of the sites inside it (ringed on the map). */
  nearby: { center: LonLat; radiusKm: number; points: LonLat[] } | null;
  route: Feature<LineString> | null;
  routeStops: LonLat[];
  layers: { districts: boolean; density: boolean };
  /** Initial camera bounds [minLon, minLat, maxLon, maxLat]. */
  initialBounds: [number, number, number, number];
  onSelect: (id: string) => void;
  onMoveEnd?: (center: LonLat) => void;
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };
const INDIA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [55, -2],
  [110, 42],
];

function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).href;
}

function siteCollection(features: HeritageFeature[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [...f.geometry.coordinates] },
      properties: { id: f.properties.id, name: f.properties.name, icon: iconKeyFor(f.properties) },
    })),
  };
}

function setData(map: MapLibreMap, id: string, data: FeatureCollection | Feature) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  src?.setData(data);
}

function boundsOf(coords: number[][]): LngLatBounds | null {
  if (coords.length === 0) return null;
  const b = new LngLatBounds([coords[0]![0]!, coords[0]![1]!], [coords[0]![0]!, coords[0]![1]!]);
  for (const c of coords) b.extend([c[0]!, c[1]!]);
  return b;
}

function panelPadding() {
  const wide = window.matchMedia?.('(min-width: 768px)').matches ?? true;
  return wide ? { top: 80, bottom: 60, left: 420, right: 440 } : { top: 60, bottom: 280, left: 20, right: 20 };
}

function clusterElement(count: number, mix: Record<IconKey, number>): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ht-cluster';
  const size = count < 10 ? 34 : count < 50 ? 42 : count < 150 ? 50 : 58;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  // Ring shows the category mix of the cluster (from clusterProperties sums).
  let acc = 0;
  const stops: string[] = [];
  for (const key of ICON_KEYS) {
    const n = mix[key] ?? 0;
    if (n <= 0) continue;
    const from = (acc / count) * 360;
    acc += n;
    const to = (acc / count) * 360;
    stops.push(`${ICON_COLORS[key]} ${from}deg ${to}deg`);
  }
  el.style.background = stops.length ? `conic-gradient(${stops.join(',')})` : ICON_COLORS.other;
  const inner = document.createElement('span');
  inner.textContent = String(count);
  el.appendChild(inner);
  el.setAttribute('aria-label', `${count} heritage sites, zoom in`);
  return el;
}

function stopElement(index: number): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ht-stop';
  el.textContent = String(index + 1);
  return el;
}

export function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const clusterMarkers = useRef(new Map<number, Marker>());
  const stopMarkers = useRef<Marker[]>([]);
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;
  const onMoveEndRef = useRef(props.onMoveEnd);
  onMoveEndRef.current = props.onMoveEnd;
  const [ready, setReady] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  const resolved = useMemo(
    () => resolveMapStyle(props.config, absoluteUrl(`${DATA_BASE}${INDIA_STATES_FILE}`)),
    [props.config],
  );

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const [w, s, e, n] = props.initialBounds;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: resolved.style,
      validateStyle: resolved.kind === 'fallback',
      bounds: [
        [w, s],
        [e, n],
      ],
      fitBoundsOptions: { padding: panelPadding() },
      maxBounds: INDIA_MAX_BOUNDS,
      minZoom: 3,
      maxZoom: 18,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
    map.on('moveend', () => {
      const c = map.getCenter();
      onMoveEndRef.current?.([c.lng, c.lat]);
    });
    map.on('error', (ev) => {
      const msg = (ev as { error?: { message?: string } }).error?.message ?? '';
      if (!map.loaded() && resolved.kind === 'amazon') setStyleError('The Amazon Location map style could not be loaded.');
      if (msg) console.warn('map error', msg.slice(0, 200));
    });

    map.on('load', () => {
      map.addSource('districts', { type: 'geojson', data: EMPTY_FC });
      map.addSource('state-outline', { type: 'geojson', data: EMPTY_FC });
      map.addSource('nearby-area', { type: 'geojson', data: EMPTY_FC });
      map.addSource('route', { type: 'geojson', data: EMPTY_FC });
      map.addSource('selected', { type: 'geojson', data: EMPTY_FC });
      map.addSource('nearby-points', { type: 'geojson', data: EMPTY_FC });
      map.addSource('sites', {
        type: 'geojson',
        data: EMPTY_FC,
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 12,
        clusterProperties: Object.fromEntries(
          ICON_KEYS.map((k) => [k, ['+', ['case', ['==', ['get', 'icon'], k], 1, 0]]]),
        ),
      });
      if (resolved.kind === 'amazon') {
        map.addSource('india-states', { type: 'geojson', data: absoluteUrl(`${DATA_BASE}${INDIA_STATES_FILE}`) });
        map.addLayer({
          id: 'india-states-line',
          type: 'line',
          source: 'india-states',
          paint: { 'line-color': '#8e6f3e', 'line-width': 0.8, 'line-opacity': 0.6 },
        });
      }

      map.addLayer({
        id: 'district-density',
        type: 'fill',
        source: 'districts',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'step',
            ['coalesce', ['get', 'density'], 0],
            DENSITY_COLORS[0],
            DENSITY_STEPS[1],
            DENSITY_COLORS[1],
            DENSITY_STEPS[2],
            DENSITY_COLORS[2],
            DENSITY_STEPS[3],
            DENSITY_COLORS[3],
            DENSITY_STEPS[4],
            DENSITY_COLORS[4],
          ],
          'fill-opacity': 0.62,
        },
      });
      map.addLayer({
        id: 'district-lines',
        type: 'line',
        source: 'districts',
        paint: { 'line-color': '#9c8a6a', 'line-width': 0.6, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
      });
      map.addLayer({
        id: 'state-outline-line',
        type: 'line',
        source: 'state-outline',
        paint: { 'line-color': '#a3432a', 'line-width': 1.6, 'line-opacity': 0.75 },
      });
      map.addLayer({
        id: 'nearby-area-fill',
        type: 'fill',
        source: 'nearby-area',
        paint: { 'fill-color': '#b8862b', 'fill-opacity': 0.1 },
      });
      map.addLayer({
        id: 'nearby-area-line',
        type: 'line',
        source: 'nearby-area',
        paint: { 'line-color': '#b8862b', 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
      });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fdfaf3', 'line-width': 7 },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#a3432a', 'line-width': 4 },
      });
      map.addLayer({
        id: 'nearby-points-ring',
        type: 'circle',
        source: 'nearby-points',
        paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#b8862b', 'circle-stroke-width': 2 },
      });
      map.addLayer({
        id: 'selected-halo',
        type: 'circle',
        source: 'selected',
        paint: {
          'circle-radius': 22,
          'circle-color': 'rgba(224,180,76,0.28)',
          'circle-stroke-color': '#e0b44c',
          'circle-stroke-width': 2.5,
        },
      });
      // Invisible layer so the clustered source is always tiled (cluster counts are HTML markers).
      map.addLayer({
        id: 'site-clusters-anchor',
        type: 'circle',
        source: 'sites',
        filter: ['has', 'point_count'],
        paint: { 'circle-radius': 1, 'circle-opacity': 0 },
      });
      // Unclustered sites: per-category SVG icons, added once the images have decoded.
      loadIconImages()
        .then((icons) => {
          if (!mapRef.current) return;
          for (const key of ICON_KEYS) if (!map.hasImage(`ht-${key}`)) map.addImage(`ht-${key}`, icons[key], { pixelRatio: 2 });
          map.addLayer({
            id: 'site-icons',
            type: 'symbol',
            source: 'sites',
            filter: ['!', ['has', 'point_count']],
            layout: {
              'icon-image': ['concat', 'ht-', ['get', 'icon']],
              'icon-allow-overlap': true,
              'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 12, 1.1],
            },
          });
        })
        .catch((err: unknown) => console.warn('marker icons failed to load', err));

      map.on('click', 'site-icons', (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        const id = f?.properties?.id;
        if (typeof id === 'string') onSelectRef.current(id);
      });
      map.on('mouseenter', 'site-icons', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'site-icons', () => (map.getCanvas().style.cursor = ''));

      // HTML cluster markers (no glyph server needed for counts).
      const updateClusters = () => {
        if (!map.getSource('sites') || !map.isSourceLoaded('sites')) return;
        const seen = new Set<number>();
        for (const f of map.querySourceFeatures('sites')) {
          const p = f.properties as Record<string, unknown> | null;
          if (!p?.cluster) continue;
          const clusterId = Number(p.cluster_id);
          if (seen.has(clusterId)) continue;
          seen.add(clusterId);
          if (clusterMarkers.current.has(clusterId)) continue;
          const coords = (f.geometry as Point).coordinates as [number, number];
          const mix = Object.fromEntries(ICON_KEYS.map((k) => [k, Number(p[k] ?? 0)])) as Record<IconKey, number>;
          const el = clusterElement(Number(p.point_count), mix);
          el.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const src = map.getSource('sites') as GeoJSONSource;
            const zoom = await src.getClusterExpansionZoom(clusterId);
            map.easeTo({ center: coords, zoom: Math.min(zoom, 14) });
          });
          clusterMarkers.current.set(clusterId, new Marker({ element: el }).setLngLat(coords).addTo(map));
        }
        for (const [id, marker] of clusterMarkers.current) {
          if (!seen.has(id)) {
            marker.remove();
            clusterMarkers.current.delete(id);
          }
        }
      };
      map.on('render', updateClusters);
      setReady(true);
    });

    return () => {
      for (const m of clusterMarkers.current.values()) m.remove();
      clusterMarkers.current.clear();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The map is created once per style; data props are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const map = ready ? mapRef.current : null;

  useEffect(() => {
    if (!map) return;
    // New data means new cluster ids; drop the old HTML markers.
    for (const m of clusterMarkers.current.values()) m.remove();
    clusterMarkers.current.clear();
    setData(map, 'sites', siteCollection(props.features));
  }, [map, props.features]);

  useEffect(() => {
    if (!map) return;
    const withDensity: FeatureCollection = {
      type: 'FeatureCollection',
      features: props.districts.features.map((d) => ({
        ...d,
        properties: {
          ...d.properties,
          density: props.densities.get(`${d.properties.stateCode}|${normalizeName(d.properties.name)}`) ?? 0,
        },
      })),
    };
    setData(map, 'districts', withDensity);
  }, [map, props.districts, props.densities]);

  useEffect(() => {
    if (!map) return;
    setData(map, 'state-outline', props.stateBoundaries);
  }, [map, props.stateBoundaries]);

  useEffect(() => {
    if (!map) return;
    map.setLayoutProperty('district-lines', 'visibility', props.layers.districts ? 'visible' : 'none');
    map.setLayoutProperty('district-density', 'visibility', props.layers.density ? 'visible' : 'none');
  }, [map, props.layers.districts, props.layers.density]);

  const selectedId = props.selected?.properties.id ?? null;
  useEffect(() => {
    if (!map) return;
    const sel = props.selected;
    setData(map, 'selected', sel ? { type: 'Feature', geometry: sel.geometry, properties: {} } : EMPTY_FC);
    if (sel) {
      // offset, not padding: flyTo padding would persist on the camera and stack with later fitBounds padding.
      const pad = panelPadding();
      map.flyTo({
        center: sel.geometry.coordinates,
        // Above clusterMaxZoom (12) so the selected icon is drawn on its own.
        zoom: Math.max(map.getZoom(), 13.5),
        offset: [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2],
        speed: 1.4,
        essential: true,
      });
    }
    // flyTo only when the selection changes, not on every re-render of the same feature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedId]);

  const nearbyKey = props.nearby ? `${props.nearby.center.join(',')}|${props.nearby.radiusKm}` : '';
  useEffect(() => {
    if (!map) return;
    const nb = props.nearby;
    if (!nb) {
      setData(map, 'nearby-area', EMPTY_FC);
      setData(map, 'nearby-points', EMPTY_FC);
      return;
    }
    const area = circle(nb.center, nb.radiusKm, { steps: 96, units: 'kilometers' });
    setData(map, 'nearby-area', area);
    const b = boundsOf(area.geometry.coordinates[0] ?? []);
    if (b) map.fitBounds(b, { padding: panelPadding(), maxZoom: 14, duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, nearbyKey]);

  const nearbyPoints = props.nearby?.points;
  useEffect(() => {
    if (!map) return;
    setData(map, 'nearby-points', {
      type: 'FeatureCollection',
      features: (nearbyPoints ?? []).map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
    });
  }, [map, nearbyPoints]);

  useEffect(() => {
    if (!map) return;
    setData(map, 'route', props.route ?? EMPTY_FC);
    if (props.route) {
      const b = boundsOf(props.route.geometry.coordinates);
      if (b) map.fitBounds(b, { padding: panelPadding(), maxZoom: 13, duration: 800 });
    }
  }, [map, props.route]);

  const stopsKey = props.routeStops.map((s) => s.join(',')).join(';');
  useEffect(() => {
    if (!map) return;
    for (const m of stopMarkers.current) m.remove();
    stopMarkers.current = props.routeStops.map((pos, i) =>
      new Marker({ element: stopElement(i), anchor: 'bottom', offset: [0, -14] }).setLngLat(pos).addTo(map),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, stopsKey]);

  return (
    <div className="absolute inset-0" data-testid="map-root" data-map-style={resolved.kind}>
      {/* maplibre's unlayered .maplibregl-map CSS sets position: relative, so size with h-full/w-full. */}
      <div ref={containerRef} className="h-full w-full" aria-label="Map of heritage sites" role="region" />
      {styleError && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-laterite-700/90 px-4 py-1.5 text-xs text-ivory-50 shadow">
          {styleError}
        </div>
      )}
    </div>
  );
}
