import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

export type AreaFeature<P = Record<string, unknown>> = Feature<Polygon | MultiPolygon, P>;
export type BBox = [number, number, number, number];

export function bboxOf(f: AreaFeature<unknown>): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rings: Position[][] = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x! < minX) minX = x!;
      if (x! > maxX) maxX = x!;
      if (y! < minY) minY = y!;
      if (y! > maxY) maxY = y!;
    }
  }
  return [minX, minY, maxX, maxY];
}

export const inBBox = (b: BBox, lon: number, lat: number, padDeg = 0): boolean =>
  lon >= b[0] - padDeg && lon <= b[2] + padDeg && lat >= b[1] - padDeg && lat <= b[3] + padDeg;

/** Display name: diacritics stripped (NFD), case kept. "Tamil Nādu" -> "Tamil Nadu". */
export const plainName = (name: string): string => name.normalize('NFD').replace(/\p{M}+/gu, '').trim();

/**
 * Deterministic FeatureCollection text: header members pretty-printed, one feature per line
 * (reviewable diffs without a 2-space-indented multi-megabyte file).
 */
export function serializeFeatureCollection(header: Record<string, unknown>, features: readonly unknown[]): string {
  const head = JSON.stringify({ type: 'FeatureCollection', ...header }, null, 2);
  const body = features.map((f) => `    ${JSON.stringify(f)}`).join(',\n');
  return `${head.slice(0, -2)},\n  "features": [\n${body}${features.length ? '\n' : ''}  ]\n}\n`;
}

export function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

export const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
