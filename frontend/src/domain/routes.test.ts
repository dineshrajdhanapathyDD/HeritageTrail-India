import { describe, expect, it } from 'vitest';
import type { CalculateRoutesResponse } from '@aws-sdk/client-geo-routes';
import { buildCalculateRoutesInput, formatDuration, MAX_ROUTE_STOPS, routeToGeoJSON } from './routes.ts';
import type { LonLat } from './nearby.ts';
import { featureById } from '../test/committedData.ts';

const stop = (id: string): LonLat => featureById(id).geometry.coordinates;

describe('buildCalculateRoutesInput', () => {
  it('builds origin and destination for two stops', () => {
    const a = stop('wd-Q3536763'); // Government Museum, Chennai
    const b = stop('wd-Q1144279'); // Shore Temple
    const input = buildCalculateRoutesInput([a, b]);
    expect(input).toEqual({ Origin: a, Destination: b, TravelMode: 'Car', LegGeometryFormat: 'Simple' });
    expect(input.Waypoints).toBeUndefined();
  });

  it('puts intermediate stops in Waypoints as [lon, lat]', () => {
    const stops = ['wd-Q3536763', 'wd-Q1144279', 'wd-Q3536493', 'wd-Q916943'].map(stop);
    const input = buildCalculateRoutesInput(stops);
    expect(input.Waypoints).toEqual([{ Position: stops[1] }, { Position: stops[2] }]);
    expect(input.Destination).toEqual(stops[3]);
  });

  it('rejects fewer than 2 or more than 25 stops', () => {
    const a = stop('wd-Q1144279');
    expect(() => buildCalculateRoutesInput([a])).toThrow(/at least 2/);
    expect(() => buildCalculateRoutesInput(Array.from({ length: MAX_ROUTE_STOPS + 1 }, () => a))).toThrow(/at most 25/);
    expect(buildCalculateRoutesInput(Array.from({ length: MAX_ROUTE_STOPS }, () => a)).Waypoints).toHaveLength(23);
  });
});

describe('routeToGeoJSON', () => {
  const response = {
    LegGeometryFormat: 'Simple',
    Notices: [],
    PricingBucket: 'x',
    Routes: [
      {
        MajorRoadLabels: [],
        Summary: { Distance: 58013, Duration: 3900 },
        Legs: [
          { Geometry: { LineString: [[80.27, 13.08], [80.25, 12.9]] } },
          { Geometry: { LineString: [[80.25, 12.9], [80.2, 12.62]] } },
        ],
      },
    ],
  } as unknown as CalculateRoutesResponse;

  it('concatenates leg geometry and reads the summary distance', () => {
    const r = routeToGeoJSON(response);
    expect(r.geometry.geometry.coordinates).toEqual([[80.27, 13.08], [80.25, 12.9], [80.2, 12.62]]);
    expect(r.distanceMeters).toBe(58013);
    expect(r.durationSeconds).toBe(3900);
    expect(r.legCount).toBe(2);
  });

  it('throws when no route is returned', () => {
    expect(() => routeToGeoJSON({ Routes: [] } as unknown as CalculateRoutesResponse)).toThrow(/No route/);
  });

  it('formats durations', () => {
    expect(formatDuration(3900)).toBe('1 h 5 min');
    expect(formatDuration(600)).toBe('10 min');
  });
});
