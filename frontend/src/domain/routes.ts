import type { CalculateRoutesRequest, CalculateRoutesResponse } from '@aws-sdk/client-geo-routes';
import type { Feature, LineString } from 'geojson';
import type { LonLat } from './nearby.ts';

/** Origin + destination + up to 23 intermediate waypoints. */
export const MAX_ROUTE_STOPS = 25;
export const MAX_WAYPOINTS = MAX_ROUTE_STOPS - 2;

/** Amazon Location Routes V2 CalculateRoutes input for an ordered list of [lon, lat] stops. */
export function buildCalculateRoutesInput(stops: readonly LonLat[]): CalculateRoutesRequest {
  if (stops.length < 2) throw new Error('A route needs at least 2 stops');
  if (stops.length > MAX_ROUTE_STOPS) throw new Error(`A route can have at most ${MAX_ROUTE_STOPS} stops`);
  const [origin] = stops;
  const destination = stops[stops.length - 1];
  const middle = stops.slice(1, -1);
  return {
    Origin: [origin![0], origin![1]],
    Destination: [destination![0], destination![1]],
    ...(middle.length > 0 ? { Waypoints: middle.map((p) => ({ Position: [p[0], p[1]] })) } : {}),
    TravelMode: 'Car',
    LegGeometryFormat: 'Simple',
  };
}

export interface RouteResult {
  geometry: Feature<LineString, { distanceMeters: number | null }>;
  distanceMeters: number | null;
  durationSeconds: number | null;
  legCount: number;
}

/** Concatenates every leg's LineString of the first route into one LineString. */
export function routeToGeoJSON(response: CalculateRoutesResponse): RouteResult {
  const route = response.Routes?.[0];
  if (!route) throw new Error('No route found between these stops');
  const coords: number[][] = [];
  for (const leg of route.Legs ?? []) {
    const line = leg.Geometry?.LineString ?? [];
    for (const point of line) {
      const last = coords[coords.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      coords.push(point);
    }
  }
  if (coords.length < 2) throw new Error('The route response had no line geometry');
  const distanceMeters = route.Summary?.Distance ?? null;
  return {
    geometry: { type: 'Feature', properties: { distanceMeters }, geometry: { type: 'LineString', coordinates: coords } },
    distanceMeters,
    durationSeconds: route.Summary?.Duration ?? null,
    legCount: route.Legs?.length ?? 0,
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
