import { describe, expect, it } from 'vitest';
import { REPO_ROOT, pathsFor } from '../src/paths.ts';
import { loadStateGeometry } from '../src/run.ts';
import {
  assignDistrict,
  canonicalDistrict,
  districtsMatch,
  levenshteinRatio,
  validateLocation,
  verificationStatus,
} from '../src/validate.ts';
import { eastOf, syntheticGeometry, tamilNadu } from './helpers.ts';

const geo = syntheticGeometry();
const at = (lon: number | null, lat: number | null, name: string | null = 'A site') => validateLocation({ name, lon, lat }, geo);

describe('validateLocation (synthetic state lon 78-80, lat 10-12)', () => {
  it('accepts points inside the claimed state', () => {
    expect(at(79, 11)).toEqual({ ok: true, flags: [] });
  });
  it('rejects missing coordinates or names', () => {
    expect(at(null, null)).toMatchObject({ ok: false, reason: 'missing-coordinates' });
    expect(at(79, 11, null)).toMatchObject({ ok: false, reason: 'missing-name' });
  });
  it('rejects points outside the India bounding box', () => {
    expect(at(2.35, 48.85)).toMatchObject({ ok: false, reason: 'outside-india-bbox' });
    expect(at(79, 5.9)).toMatchObject({ ok: false, reason: 'outside-india-bbox' });
  });
  it('accepts coastal points within 2 km of the edge with boundary-tolerance', () => {
    expect(at(eastOf(80, 11, 1.5), 11)).toEqual({ ok: true, flags: ['boundary-tolerance'] });
    expect(at(78 - (eastOf(78, 11, 1.9) - 78), 11)).toEqual({ ok: true, flags: ['boundary-tolerance'] });
  });
  it('rejects points outside the claimed state beyond tolerance and reports the detected state', () => {
    expect(at(eastOf(80, 11, 5), 11)).toEqual({ ok: false, reason: 'outside-claimed-state', detectedState: 'Neighbour' });
    expect(at(77.5, 11)).toEqual({ ok: false, reason: 'outside-claimed-state', detectedState: null });
  });
});

describe('district assignment', () => {
  it('derives the district from ADM2 when the source has none', () => {
    expect(assignDistrict(geo, 78.5, 11, null)).toMatchObject({ district: 'Kancheepuram', flags: ['district-derived'] });
  });
  it('accepts spelling variants (Levenshtein ratio >= 0.8) and uses the ADM2 spelling', () => {
    expect(assignDistrict(geo, 78.5, 11, 'Kanchipuram')).toMatchObject({ district: 'Kancheepuram', flags: [] });
    expect(assignDistrict(geo, 79.5, 11, 'Nilgiris district')).toMatchObject({ district: 'The Nilgiris', flags: [] });
  });
  it('keeps the source district and flags a mismatch', () => {
    expect(assignDistrict(geo, 78.5, 11, 'Madurai')).toEqual({
      district: 'Madurai',
      flags: ['district-mismatch'],
      claimed: 'Madurai',
      adm2: 'Kancheepuram',
    });
    // A claim matching another ADM2 district is normalised to that district's spelling.
    expect(assignDistrict(geo, 78.5, 11, 'Nilgiris')).toMatchObject({ district: 'The Nilgiris', flags: ['district-mismatch'] });
  });
  it('uses the nearest district within 2 km, and flags missing districts', () => {
    expect(assignDistrict(geo, eastOf(80, 11, 1), 11, null).district).toBe('The Nilgiris');
    expect(assignDistrict(geo, 85, 11, null)).toMatchObject({ district: null, flags: ['missing-district'] });
    expect(assignDistrict(geo, 85, 11, 'Somewhere')).toMatchObject({ district: 'Somewhere', flags: [] });
  });
  it('compares names with a normalized Levenshtein ratio', () => {
    expect(levenshteinRatio('abc', 'abc')).toBe(1);
    expect(districtsMatch('Thoothukudi', 'Thoothukkudi')).toBe(true);
    expect(districtsMatch('Chengalpattu district', 'Chengalputtu')).toBe(true);
    expect(districtsMatch('Madurai', 'Dindigul')).toBe(false);
    expect(canonicalDistrict(geo, 'Unknown Place')).toBe('Unknown Place');
  });
});

describe('verification status (decision 14)', () => {
  it('needs an identifier or two agreeing sources', () => {
    expect(verificationStatus({ hasAsiId: true, hasWhsId: false, sourcesAgree: false })).toBe('verified');
    expect(verificationStatus({ hasAsiId: false, hasWhsId: true, sourcesAgree: false })).toBe('verified');
    expect(verificationStatus({ hasAsiId: false, hasWhsId: false, sourcesAgree: true })).toBe('verified');
    expect(verificationStatus({ hasAsiId: false, hasWhsId: false, sourcesAgree: false })).toBe('unverified');
  });
});

describe('real geoBoundaries polygons (committed data/processed/boundaries)', () => {
  const real = loadStateGeometry(pathsFor(REPO_ROOT), tamilNadu).geo;
  it('accepts a Tamil Nadu point and assigns its district', () => {
    // Delhi Gate, Arcot (Wikidata Q97481253, P625 Point(79.3378 12.9075)).
    expect(validateLocation({ name: 'Delhi Gate', lon: 79.3378, lat: 12.9075 }, real)).toEqual({ ok: true, flags: [] });
    expect(assignDistrict(real, 79.3378, 12.9075, 'Ranipet').district).toBe('Ranipet');
  });
  it('rejects a point in Kerala claimed for Tamil Nadu', () => {
    // Western Ghats (Wikidata Q4527, P625 Point(77.061111111 10.169722222)), returned by the Tamil Nadu WHS query.
    expect(validateLocation({ name: 'Western Ghats', lon: 77.061111111, lat: 10.169722222 }, real)).toEqual({
      ok: false,
      reason: 'outside-claimed-state',
      detectedState: 'Kerala',
    });
  });
  it('has 38 Tamil Nadu districts', () => {
    expect(real.districts).toHaveLength(38);
  });
});
