// Map interactions, filters and search, run on the committed Tamil Nadu data with maplibre-gl mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HeritageFeature } from '@heritagetrail/shared';
import App from './App.tsx';
import { CATEGORY_LABELS } from './domain/categories.ts';
import { periodBucket, periodOptions } from './domain/filters.ts';
import { committedFeatures, processedFetch } from './test/committedData.ts';
import { instances, type FakeMap } from './test/maplibreMock.ts';
vi.mock('maplibre-gl', () => import('./test/maplibreMock.ts'));
const features = committedFeatures();
const verified = features.filter((f) => f.properties.verificationStatus === 'verified');
/** Independent text match over the fields the search covers (name, state, district, category, designations). */
function textMatches(f: HeritageFeature, re: RegExp): boolean {
  const p = f.properties;
  return re.test([p.name, p.state, p.district ?? '', p.category, CATEGORY_LABELS[p.category], ...p.designations].join(' '));
}
async function renderLoaded() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('result-count', {}, { timeout: 5000 });
  // Wait until the map has loaded and the clustered source exists.
  await waitFor(() => expect(instances[0]?.sources.get('sites')).toBeDefined());
  return { user, map: instances[0] as FakeMap };
}
const explorePanel = () => screen.getByRole('complementary', { name: 'Explore heritage sites' });
const count = () => Number(screen.getByTestId('result-count').textContent?.match(/\d[\d,]*/)?.[0]?.replace(/,/g, ''));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal('fetch', processedFetch());
});
afterEach(() => vi.unstubAllGlobals());
describe('map interactions', () => {
  it('clicking a site icon on the map opens its details and flies to it', async () => {
    const { map } = await renderLoaded();
    const shore = verified.find((f) => f.properties.name === 'Shore Temple')!;
    expect(shore).toBeDefined();
    act(() => map.fire('click:site-icons', { features: [{ properties: { id: shore.properties.id } }] }));
    const dialog = await screen.findByRole('dialog', { name: /Details: Shore Temple/ });
    expect(within(dialog).getByText('Verified')).toBeInTheDocument();
    await waitFor(() => expect(map.flyTo.calls.length).toBeGreaterThan(0));
    expect(map.flyTo.calls.at(-1)![0]).toMatchObject({ center: shore.geometry.coordinates });
    expect((map.sources.get('selected')!.data as { geometry: unknown }).geometry).toEqual(shore.geometry);
  });
  it('ignores map clicks without a site id', async () => {
    const { map } = await renderLoaded();
    act(() => map.fire('click:site-icons', { features: [] }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('renders HTML cluster markers and zooms into a cluster on click', async () => {
    const { user, map } = await renderLoaded();
    map.sourceFeatures = [
      {
        properties: { cluster: true, cluster_id: 7, point_count: 12, temple: 9, fort: 3 },
        geometry: { type: 'Point', coordinates: [79.1, 10.8] },
      },
    ];
    act(() => map.fire('render'));
    const marker = await screen.findByRole('button', { name: '12 heritage sites, zoom in' });
    expect(marker).toHaveTextContent('12');
    await user.click(marker);
    // The mocked source reports expansion zoom 10.
    await waitFor(() => expect(map.easeTo.calls).toEqual([[{ center: [79.1, 10.8], zoom: 10 }]]));
    // A cluster that disappears from the source removes its marker.
    map.sourceFeatures = [];
    act(() => map.fire('render'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '12 heritage sites, zoom in' })).toBeNull());
  });
});
describe('filters', () => {
  it('UNESCO only keeps sites with a UNESCO status', async () => {
    const { user, map } = await renderLoaded();
    await user.click(within(explorePanel()).getByRole('button', { name: /UNESCO only/ }));
    const expected = verified.filter((f) => f.properties.unesco !== null).length;
    expect(expected).toBeGreaterThan(0);
    expect(count()).toBe(expected);
    await waitFor(() => expect((map.sources.get('sites')!.data as { features: unknown[] }).features).toHaveLength(expected));
  });
  it('a period chip keeps only sites in that period bucket', async () => {
    const { user } = await renderLoaded();
    const option = periodOptions(verified).find((p) => p.bucket.startsWith('c'))!;
    expect(option).toBeDefined();
    await user.click(within(explorePanel()).getByRole('button', { name: new RegExp(`^${escape(option.label)}`) }));
    expect(count()).toBe(verified.filter((f) => periodBucket(f.properties) === option.bucket).length);
    expect(count()).toBe(option.count);
  });
  it('category, UNESCO and include-unverified combine', async () => {
    const { user } = await renderLoaded();
    await user.click(within(explorePanel()).getByRole('button', { name: /^Temple/ }));
    await user.click(within(explorePanel()).getByRole('button', { name: /^Museum/ }));
    const both = (fs: HeritageFeature[]) => fs.filter((f) => ['temple', 'museum'].includes(f.properties.category)).length;
    expect(count()).toBe(both(verified));
    await user.click(screen.getByRole('checkbox', { name: /include unverified/i }));
    expect(count()).toBe(both(features));
    await user.click(within(explorePanel()).getByRole('button', { name: /UNESCO only/ }));
    expect(count()).toBe(features.filter((f) => ['temple', 'museum'].includes(f.properties.category) && f.properties.unesco !== null).length);
  });
});
describe('search', () => {
  it.each([
    ['state', 'Tamil Nadu', /tamil nadu/i],
    ['district', 'Madurai', /madurai/i],
    ['category', 'museum', /museum/i],
    ['name', 'Gingee', /gingee/i],
  ])('by %s ("%s")', async (_kind, query, re) => {
    const { user } = await renderLoaded();
    await user.type(screen.getByRole('searchbox'), query);
    const expected = verified.filter((f) => textMatches(f, re)).length;
    expect(expected).toBeGreaterThan(0);
    expect(count()).toBe(expected);
  });
  it('search by district lists only sites in or named after that district', async () => {
    const { user } = await renderLoaded();
    await user.type(screen.getByRole('searchbox'), 'Kanniyakumari');
    const expected = verified.filter((f) => textMatches(f, /kanniyakumari/i));
    expect(count()).toBe(expected.length);
    expect(expected.every((f) => f.properties.district === 'Kanniyakumari' || /kanniyakumari/i.test(f.properties.name))).toBe(true);
  });
});
