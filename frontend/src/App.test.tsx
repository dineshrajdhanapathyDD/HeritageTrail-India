import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.tsx';
import { committedFeatures, processedFetch } from './test/committedData.ts';
import { instances } from './test/maplibreMock.ts';
import { LOCAL_ROUTING_MESSAGE } from './components/RoutePanel.tsx';

vi.mock('maplibre-gl', () => import('./test/maplibreMock.ts'));

const routes = vi.hoisted(() => ({
  send: vi.fn(),
  configs: [] as unknown[],
  inputs: [] as unknown[],
}));
vi.mock('@aws-sdk/client-geo-routes', () => ({
  GeoRoutesClient: class {
    constructor(config: unknown) {
      routes.configs.push(config);
    }
    send(cmd: { input: unknown }) {
      return routes.send(cmd);
    }
  },
  CalculateRoutesCommand: class {
    constructor(public input: unknown) {
      routes.inputs.push(input);
    }
  },
}));

const features = committedFeatures();
const verifiedCount = features.filter((f) => f.properties.verificationStatus === 'verified').length;

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('result-count', {}, { timeout: 5000 });
  return user;
}

const explorePanel = () => screen.getByRole('complementary', { name: 'Explore heritage sites' });

describe('App in local mode (no API key)', () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal('fetch', processedFetch());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the committed Tamil Nadu data and shows verified sites by default', async () => {
    await renderApp();
    expect(screen.getByTestId('result-count')).toHaveTextContent(`${verifiedCount} sites`);
    expect(screen.getByTestId('map-root')).toHaveAttribute('data-map-style', 'fallback');
    // The clustered map source receives exactly the visible features.
    await waitFor(() => {
      const src = instances[0]?.sources.get('sites');
      expect((src?.data as { features: unknown[] } | undefined)?.features).toHaveLength(verifiedCount);
    });
    expect(instances[0]?.sources.get('sites')?.spec).toMatchObject({ cluster: true, clusterRadius: 50 });
  });

  it('search narrows the list', async () => {
    const user = await renderApp();
    await user.type(screen.getByRole('searchbox'), 'Thanjavur');
    const expected = features.filter(
      (f) =>
        f.properties.verificationStatus === 'verified' &&
        /thanjavur/i.test(`${f.properties.name} ${f.properties.district ?? ''}`),
    ).length;
    expect(screen.getByTestId('result-count')).toHaveTextContent(`${expected} sites`);
    expect(expected).toBeLessThan(verifiedCount);
  });

  it('filter chips restrict by category and can be cleared', async () => {
    const user = await renderApp();
    await user.click(within(explorePanel()).getByRole('button', { name: /^Fort/ }));
    const forts = features.filter((f) => f.properties.verificationStatus === 'verified' && f.properties.category === 'fort');
    expect(screen.getByTestId('result-count')).toHaveTextContent(`${forts.length} sites`);
    await user.click(screen.getByRole('checkbox', { name: /include unverified/i }));
    expect(screen.getByTestId('result-count')).toHaveTextContent(
      `${features.filter((f) => f.properties.category === 'fort').length} sites`,
    );
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByTestId('result-count')).toHaveTextContent(`${features.length} sites`);
  });

  it('selecting a list item opens the details panel with sources and verification', async () => {
    const user = await renderApp();
    await user.type(screen.getByRole('searchbox'), 'Prahadisvarar');
    await user.click(within(explorePanel()).getByRole('button', { name: /Prahadisvarar Temple/ }));
    const dialog = await screen.findByRole('dialog', { name: /Details: Prahadisvarar Temple/ });
    expect(within(dialog).getByRole('link', { name: /Wikidata Q916943/ })).toHaveAttribute(
      'href',
      'https://www.wikidata.org/wiki/Q916943',
    );
    expect(within(dialog).getByText('Verified')).toBeInTheDocument();
    expect(within(dialog).getByText('Thanjavur')).toBeInTheDocument();
    expect(within(dialog).getByText(/10\.78306, 79\.13250/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Part of a UNESCO World Heritage Site/ })).toHaveAttribute(
      'href',
      'https://whc.unesco.org/en/list/250',
    );
    // No AI summary button without an API base URL.
    expect(within(dialog).queryByText(/AI summary/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('nearby radius changes the results', async () => {
    const user = await renderApp();
    await user.type(screen.getByRole('searchbox'), 'Shore Temple');
    await user.click(within(explorePanel()).getByRole('button', { name: /^Shore Temple/ }));
    const dialog = await screen.findByRole('dialog', { name: /Details: Shore Temple/ });
    await user.click(within(dialog).getByRole('button', { name: 'Explore nearby' }));
    expect(screen.getByTestId('nearby-centre')).toHaveTextContent('Shore Temple');
    // Nearby uses the current filters; clear the search so it covers all verified sites.
    await user.click(screen.getByRole('tab', { name: 'Explore' }));
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('tab', { name: 'Nearby' }));

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '2' } });
    expect(screen.getByTestId('nearby-radius-value')).toHaveTextContent('2 km');
    const small = Number(screen.getByTestId('nearby-count').textContent?.split(' ')[0]);
    fireEvent.change(slider, { target: { value: '60' } });
    const large = Number(screen.getByTestId('nearby-count').textContent?.split(' ')[0]);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(within(screen.getByRole('region', { name: 'Nearby sites' })).getByText('Descent of the Ganges')).toBeInTheDocument();
  });

  it('routing shows the needs-key message and does not call Amazon Location', async () => {
    const user = await renderApp();
    await user.click(screen.getByRole('tab', { name: 'Route' }));
    expect(screen.getByRole('status')).toHaveTextContent(LOCAL_ROUTING_MESSAGE);
    expect(screen.getByRole('button', { name: 'Calculate route' })).toBeDisabled();
    expect(routes.send).not.toHaveBeenCalled();
  });

  it('insights total equals the verified count in the GeoJSON', async () => {
    const user = await renderApp();
    await user.click(screen.getByRole('tab', { name: 'Insights' }));
    expect(screen.getByTestId('insights-total-verified')).toHaveTextContent(verifiedCount.toLocaleString());
    expect(screen.getByRole('table', { name: 'District density' })).toBeInTheDocument();
  });
});

describe('App with an Amazon Location API key', () => {
  beforeEach(() => {
    instances.length = 0;
    routes.send.mockReset();
    routes.configs.length = 0;
    routes.inputs.length = 0;
    vi.stubGlobal('fetch', processedFetch({ '/config.json': { region: 'ap-south-1', locationApiKey: 'test-key' } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the Amazon style and calculates a route through the mocked client', async () => {
    routes.send.mockResolvedValue({
      Routes: [
        {
          Summary: { Distance: 58013, Duration: 3900 },
          Legs: [{ Geometry: { LineString: [[80.2573, 13.0707], [80.2, 12.8], [80.1986, 12.6164]] } }],
        },
      ],
    });
    const user = await renderApp();
    expect(screen.getByTestId('map-root')).toHaveAttribute('data-map-style', 'amazon');
    // The map instance is created in an effect; under load it can appear after the result count.
    await waitFor(() =>
      expect(String(instances[0]?.options.style)).toBe(
        'https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Standard/descriptor?key=test-key',
      ),
    );

    for (const name of ['Government Museum, Chennai', 'Shore Temple']) {
      await user.clear(screen.getByRole('searchbox'));
      await user.type(screen.getByRole('searchbox'), name);
      await user.click(within(explorePanel()).getByRole('button', { name: new RegExp(`^${name}`) }));
      const dialog = await screen.findByRole('dialog', { name: new RegExp(`Details: ${name}`) });
      await user.click(within(dialog).getByRole('button', { name: 'Add to route' }));
    }
    await user.click(screen.getByRole('tab', { name: /Route/ }));
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole('button', { name: 'Calculate route' }));

    expect(await screen.findByTestId('route-result')).toHaveTextContent('58.0 km');
    expect(routes.send).toHaveBeenCalledTimes(1);
    expect(routes.inputs[0]).toMatchObject({
      Origin: [80.257289, 13.07065],
      Destination: [80.19861111, 12.61638889],
      TravelMode: 'Car',
      LegGeometryFormat: 'Simple',
    });
    // API key auth only: region set, empty credential provider, no AWS access keys.
    expect(routes.configs[0]).toMatchObject({ region: 'ap-south-1' });
    expect(JSON.stringify(routes.configs[0])).not.toMatch(/accessKeyId|secretAccessKey/);
    await waitFor(() =>
      expect((instances[0]?.sources.get('route')?.data as { geometry?: { coordinates: unknown[] } }).geometry?.coordinates).toHaveLength(3),
    );
  });
});
