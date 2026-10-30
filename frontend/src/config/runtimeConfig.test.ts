import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig, resolveRuntimeConfig } from './runtimeConfig.ts';

describe('runtime config', () => {
  it('defaults to local mode with no key', () => {
    expect(resolveRuntimeConfig(null, {})).toEqual({
      mode: 'local',
      region: 'us-east-1',
      locationApiKey: null,
      mapStyle: 'Standard',
      apiBaseUrl: null,
      summariesEnabled: false,
    });
  });

  it('prefers config.json over env and validates values', () => {
    const c = resolveRuntimeConfig(
      { locationApiKey: 'k1', region: 'us-east-1', mapStyle: 'Monochrome', apiBaseUrl: 'https://api.example.test/dev/', summariesEnabled: true },
      { VITE_LOCATION_API_KEY: 'k2', VITE_AWS_REGION: 'eu-west-1' },
    );
    expect(c).toMatchObject({ mode: 'aws', locationApiKey: 'k1', region: 'us-east-1', mapStyle: 'Monochrome' });
    expect(c.apiBaseUrl).toBe('https://api.example.test/dev');
    expect(c.summariesEnabled).toBe(true);
    const bad = resolveRuntimeConfig({ region: 'not a region', mapStyle: 'Neon', apiBaseUrl: 'javascript:alert(1)', summariesEnabled: true }, {});
    expect(bad).toMatchObject({ region: 'us-east-1', mapStyle: 'Standard', apiBaseUrl: null, summariesEnabled: false });
  });

  it('falls back to env when config.json is missing or not JSON', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    expect((await loadRuntimeConfig(notFound, { VITE_LOCATION_API_KEY: 'env-key' })).locationApiKey).toBe('env-key');
    const html = (async () => new Response('<!doctype html>', { status: 200 })) as typeof fetch;
    expect((await loadRuntimeConfig(html, {})).mode).toBe('local');
  });
});
