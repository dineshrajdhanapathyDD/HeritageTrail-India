// Minimal stand-in for maplibre-gl in jsdom (no WebGL). Records sources and calls for assertions.
type Handler = (...args: unknown[]) => void;

export class FakeSource {
  data: unknown;
  constructor(public spec: Record<string, unknown>) {
    this.data = spec.data;
  }
  setData(d: unknown) {
    this.data = d;
    return this;
  }
  async getClusterExpansionZoom() {
    return 10;
  }
}

export const instances: FakeMap[] = [];

export class FakeMap {
  handlers = new Map<string, Handler[]>();
  sources = new Map<string, FakeSource>();
  layers: Record<string, unknown>[] = [];
  flyTo = vitestFn();
  fitBounds = vitestFn();
  easeTo = vitestFn();
  /** Features returned by querySourceFeatures (tests put cluster features here). */
  sourceFeatures: unknown[] = [];
  constructor(public options: Record<string, unknown>) {
    instances.push(this);
    setTimeout(() => this.fire('load'), 0);
  }
  on(type: string, layerOrFn: string | Handler, fn?: Handler) {
    const key = typeof layerOrFn === 'string' ? `${type}:${layerOrFn}` : type;
    const h = (typeof layerOrFn === 'string' ? fn : layerOrFn) as Handler;
    this.handlers.set(key, [...(this.handlers.get(key) ?? []), h]);
    return this;
  }
  fire(key: string, ...args: unknown[]) {
    for (const h of this.handlers.get(key) ?? []) h(...args);
  }
  addControl() {
    return this;
  }
  addSource(id: string, spec: Record<string, unknown>) {
    this.sources.set(id, new FakeSource(spec));
    return this;
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addLayer(layer: Record<string, unknown>) {
    this.layers.push(layer);
    return this;
  }
  hasImage() {
    return false;
  }
  addImage() {
    return this;
  }
  setLayoutProperty() {
    return this;
  }
  getZoom() {
    return 7;
  }
  getCenter() {
    return { lng: 78.6, lat: 11.1 };
  }
  getCanvas() {
    return { style: {} as Record<string, string> };
  }
  loaded() {
    return true;
  }
  isSourceLoaded() {
    return true;
  }
  querySourceFeatures() {
    return this.sourceFeatures;
  }
  remove() {}
}

function vitestFn() {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]) => {
    calls.push(args);
  };
  fn.calls = calls;
  return fn;
}

/** Markers attach their element to document.body so tests can click HTML cluster markers. */
export class Marker {
  element: HTMLElement | undefined;
  lngLat: unknown;
  constructor(options: { element?: HTMLElement } = {}) {
    this.element = options.element;
  }
  setLngLat(lngLat: unknown) {
    this.lngLat = lngLat;
    return this;
  }
  addTo() {
    if (this.element) document.body.appendChild(this.element);
    return this;
  }
  remove() {
    this.element?.remove();
  }
}

export class LngLatBounds {
  constructor(..._args: unknown[]) {}
  extend() {
    return this;
  }
}

export class NavigationControl {}
export class ScaleControl {}
export function setWorkerUrl() {}
export { FakeMap as Map };
