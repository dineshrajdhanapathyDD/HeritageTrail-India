import { haversineKm, normalizeName, POSSIBLE_DUPLICATE_PREFIX, type Category, type Flag } from '@heritagetrail/shared';
import type { CandidateRecord } from './adapters/types.ts';
import { compareStrings } from './rawStore.ts';

export const NAME_MERGE_KM = 0.3;
export const NEAR_DUPLICATE_KM = 0.05;
export const CONFLICT_KM = 0.5;

/** A located candidate (validation guarantees name and coordinates). */
export type LocatedCandidate = CandidateRecord & { name: string; lon: number; lat: number; locationFlags: Flag[] };

export interface MergedRecord {
  primary: LocatedCandidate;
  /** Absorbed candidates from the same or other sources (primary excluded). */
  members: LocatedCandidate[];
  mergeReasons: ('wikidata-tag' | 'same-name')[];
  flags: Set<Flag>;
}

export interface DedupeStats {
  mergedByWikidataTag: number;
  mergedByName: number;
  possibleDuplicatePairs: number;
  coordinateConflicts: number;
}

const pos = (c: LocatedCandidate): [number, number] => [c.lon, c.lat];
const isWikidata = (c: LocatedCandidate): boolean => c.key.startsWith('wd-');

/**
 * Decision 15.
 * (a) an OSM element whose `wikidata` tag equals a Wikidata QID merges into that record;
 * (b) same normalized name within 300 m merges, except two distinct Wikidata items or elements
 *     tagged with different QIDs, which are flagged as possible duplicates instead;
 * (c) different names within 50 m and same category are flagged `possible-duplicate:<id>`.
 * Wikidata coordinates win; a member more than 500 m from the primary adds `coordinate-conflict`.
 */
export function dedupe(candidates: readonly LocatedCandidate[]): { records: MergedRecord[]; stats: DedupeStats } {
  const ordered = [...candidates].sort(
    (a, b) => Number(isWikidata(b)) - Number(isWikidata(a)) || compareStrings(a.key, b.key),
  );
  const stats: DedupeStats = { mergedByWikidataTag: 0, mergedByName: 0, possibleDuplicatePairs: 0, coordinateConflicts: 0 };
  const records: MergedRecord[] = [];
  const byQid = new Map<string, MergedRecord>();
  const absorbed = new Set<string>();

  for (const c of ordered) {
    if (!isWikidata(c)) continue;
    const r: MergedRecord = { primary: c, members: [], mergeReasons: [], flags: new Set() };
    records.push(r);
    if (c.wikidataQid) byQid.set(c.wikidataQid, r);
  }
  // (a) wikidata tag
  for (const c of ordered) {
    if (isWikidata(c) || !c.wikidataQid) continue;
    const target = byQid.get(c.wikidataQid);
    if (!target) continue;
    target.members.push(c);
    target.mergeReasons.push('wikidata-tag');
    absorbed.add(c.key);
    stats.mergedByWikidataTag++;
  }
  for (const c of ordered) {
    if (!isWikidata(c) && !absorbed.has(c.key)) records.push({ primary: c, members: [], mergeReasons: [], flags: new Set() });
  }

  // (b) same normalized name within 300 m
  const nameOf = new Map(records.map((r) => [r, normalizeName(r.primary.name)]));
  const groups = new Map<string, MergedRecord[]>();
  for (const r of records) {
    const list = groups.get(nameOf.get(r)!) ?? [];
    list.push(r);
    groups.set(nameOf.get(r)!, list);
  }
  const removed = new Set<MergedRecord>();
  const sameNamePairs: [MergedRecord, MergedRecord][] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      if (removed.has(a)) continue;
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j]!;
        if (removed.has(b)) continue;
        if (haversineKm(pos(a.primary), pos(b.primary)) > NAME_MERGE_KM) continue;
        const qa = a.primary.wikidataQid;
        const qb = b.primary.wikidataQid;
        if ((isWikidata(a.primary) && isWikidata(b.primary)) || (qa && qb && qa !== qb)) {
          sameNamePairs.push([a, b]);
          continue;
        }
        a.members.push(b.primary, ...b.members);
        a.mergeReasons.push('same-name', ...b.mergeReasons);
        removed.add(b);
        stats.mergedByName++;
      }
    }
  }
  const kept = records.filter((r) => !removed.has(r));

  // coordinate conflicts
  for (const r of kept) {
    if (r.members.some((m) => haversineKm(pos(r.primary), pos(m)) > CONFLICT_KM)) {
      r.flags.add('coordinate-conflict');
      stats.coordinateConflicts++;
    }
  }

  // (c) near duplicates with different names, plus same-name pairs that were not merged
  const flagPair = (a: MergedRecord, b: MergedRecord) => {
    a.flags.add(`${POSSIBLE_DUPLICATE_PREFIX}${b.primary.key}` as Flag);
    b.flags.add(`${POSSIBLE_DUPLICATE_PREFIX}${a.primary.key}` as Flag);
    stats.possibleDuplicatePairs++;
  };
  for (const [a, b] of sameNamePairs) flagPair(a, b);
  const latKm = NEAR_DUPLICATE_KM / 111;
  const byLat = [...kept].sort((a, b) => a.primary.lat - b.primary.lat);
  for (let i = 0; i < byLat.length; i++) {
    const a = byLat[i]!;
    for (let j = i + 1; j < byLat.length && byLat[j]!.primary.lat - a.primary.lat <= latKm; j++) {
      const b = byLat[j]!;
      if (mergedCategory(a) !== mergedCategory(b) || nameOf.get(a) === nameOf.get(b)) continue;
      if (haversineKm(pos(a.primary), pos(b.primary)) <= NEAR_DUPLICATE_KM) flagPair(a, b);
    }
  }

  kept.sort((a, b) => compareStrings(a.primary.key, b.primary.key));
  for (const r of kept) r.members.sort((a, b) => compareStrings(a.key, b.key));
  return { records: kept, stats };
}

/** Primary category, unless it is `other` and a merged member has a specific one. */
export function mergedCategory(r: MergedRecord): Category {
  if (r.primary.category !== 'other') return r.primary.category;
  return r.members.find((m) => m.category !== 'other')?.category ?? 'other';
}

/** True when a member from a different source lies within 500 m of the primary. */
export function sourcesAgree(r: MergedRecord): boolean {
  return r.members.some((m) => m.source !== r.primary.source && haversineKm(pos(r.primary), pos(m)) <= CONFLICT_KM);
}
