import type { StyleSpecification } from 'maplibre-gl';
import type { RuntimeConfig } from '../config/runtimeConfig.ts';
import { fallbackStyle } from './fallbackStyle.ts';

/** Amazon Location Maps V2 style descriptor URL (API key auth). */
export function amazonStyleUrl(region: string, style: string, apiKey: string): string {
  return `https://maps.geo.${region}.amazonaws.com/v2/styles/${encodeURIComponent(style)}/descriptor?key=${encodeURIComponent(apiKey)}`;
}

export interface ResolvedMapStyle {
  kind: 'amazon' | 'fallback';
  style: string | StyleSpecification;
}

export function resolveMapStyle(config: RuntimeConfig, indiaStatesUrl: string): ResolvedMapStyle {
  if (config.locationApiKey) {
    return { kind: 'amazon', style: amazonStyleUrl(config.region, config.mapStyle, config.locationApiKey) };
  }
  return { kind: 'fallback', style: fallbackStyle(indiaStatesUrl) };
}
