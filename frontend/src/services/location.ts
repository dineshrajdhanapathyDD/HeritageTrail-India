// Browser calls to Amazon Location Service V2 with the restricted API key (design decision 12).
// No AWS credentials are used: withAPIKey adds `?key=` to each request and disables the credential chain.
import { CalculateRoutesCommand, GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import { GeocodeCommand, GeoPlacesClient } from '@aws-sdk/client-geo-places';
import { withAPIKey } from '@aws/amazon-location-utilities-auth-helper';
import type { RuntimeConfig } from '../config/runtimeConfig.ts';
import type { LonLat } from '../domain/nearby.ts';
import { buildCalculateRoutesInput, routeToGeoJSON, type RouteResult } from '../domain/routes.ts';

export class LocationNotConfiguredError extends Error {
  constructor() {
    super('Amazon Location API key not configured');
  }
}

function clientConfig(config: RuntimeConfig) {
  if (!config.locationApiKey) throw new LocationNotConfiguredError();
  return withAPIKey(config.locationApiKey, config.region).getClientConfig();
}

let routesClient: { key: string; client: GeoRoutesClient } | null = null;
let placesClient: { key: string; client: GeoPlacesClient } | null = null;

function getRoutesClient(config: RuntimeConfig): GeoRoutesClient {
  const key = `${config.region}|${config.locationApiKey}`;
  if (!routesClient || routesClient.key !== key) routesClient = { key, client: new GeoRoutesClient(clientConfig(config)) };
  return routesClient.client;
}

function getPlacesClient(config: RuntimeConfig): GeoPlacesClient {
  const key = `${config.region}|${config.locationApiKey}`;
  if (!placesClient || placesClient.key !== key) placesClient = { key, client: new GeoPlacesClient(clientConfig(config)) };
  return placesClient.client;
}

export async function calculateRoute(config: RuntimeConfig, stops: LonLat[]): Promise<RouteResult> {
  const input = buildCalculateRoutesInput(stops);
  const response = await getRoutesClient(config).send(new CalculateRoutesCommand(input));
  return routeToGeoJSON(response);
}

export interface PlaceResult {
  title: string;
  position: LonLat;
}

/** Geocodes free text inside India, biased towards `bias` ([lon, lat]). */
export async function geocodePlace(config: RuntimeConfig, query: string, bias: LonLat): Promise<PlaceResult[]> {
  const text = query.trim().slice(0, 200);
  if (!text) return [];
  const response = await getPlacesClient(config).send(
    new GeocodeCommand({ QueryText: text, BiasPosition: [bias[0], bias[1]], Filter: { IncludeCountries: ['IND'] }, MaxResults: 5 }),
  );
  return (response.ResultItems ?? [])
    .filter((r) => r.Position && r.Position.length >= 2)
    .map((r) => ({ title: r.Title ?? text, position: [r.Position![0]!, r.Position![1]!] as LonLat }));
}

/** User-facing message for SDK errors without echoing request details. */
export function describeLocationError(err: unknown): string {
  if (err instanceof LocationNotConfiguredError) return err.message;
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'AccessDeniedException') return 'The Amazon Location API key was rejected for this site.';
  if (name === 'ThrottlingException') return 'Amazon Location is throttling requests; try again shortly.';
  if (name === 'ValidationException') return 'Amazon Location could not use these stops.';
  if (err instanceof Error && /No route|no line geometry|at least|at most/.test(err.message)) return err.message;
  return 'The request to Amazon Location failed.';
}
