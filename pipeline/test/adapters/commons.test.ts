import { describe, expect, it } from 'vitest';
import { buildCommonsBatches, cleanUrl, resolveImages, resolvePage, stripHtml } from '../../src/adapters/commons.ts';
import { getSource } from '../../src/config.ts';
import { config, fixture } from '../helpers.ts';

interface Page {
  title: string;
  imageinfo: { extmetadata: Record<string, { value: string } | undefined> }[];
}
const response = fixture<{ query: { pages: Record<string, Page> } }>('commons-imageinfo.json');
const pageByTitle = (t: string): Page => structuredClone(Object.values(response.query.pages).find((p) => p.title === `File:${t}`)!);
const payload = (body: unknown) => [{ name: 'batch-001', fetchedAt: '2026-10-30T08:14:30.000Z', body }];

describe('Commons licence filtering', () => {
  it('keeps a file whose licence, licence URL and author resolve', () => {
    const r = resolveImages(['Delhi gate - river side view.jpg'], payload(response)).get('Delhi gate - river side view.jpg');
    expect(r).toEqual({
      ok: true,
      image: {
        url: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Delhi_gate_-_river_side_view.jpg',
        thumbUrl: expect.stringMatching(/^https:\/\/.*Delhi_gate_-_river_side_view\.jpg$/),
        filePageUrl: 'https://commons.wikimedia.org/wiki/File:Delhi_gate_-_river_side_view.jpg',
        license: 'CC BY-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
        artist: 'Priasai',
        credit: 'Own work',
      },
    });
  });
  it('keeps public-domain files without a licence URL', () => {
    const r = resolveImages(['Madras museum theatre in October 2007.jpg'], payload(response)).get('Madras museum theatre in October 2007.jpg');
    expect(r?.ok && r.image.license).toBe('Public domain');
    expect(r?.ok && r.image.licenseUrl).toBeNull();
  });
  it('drops files with an unresolved author, licence or licence URL', () => {
    const noArtist = pageByTitle('Fort Dansborg.JPG');
    delete noArtist.imageinfo[0]!.extmetadata.Artist;
    expect(resolvePage(noArtist as never)).toEqual({ ok: false, reason: 'author-unresolved' });

    const unknownArtist = pageByTitle('Fort Dansborg.JPG');
    unknownArtist.imageinfo[0]!.extmetadata.Artist = { value: 'Unknown author' };
    expect(resolvePage(unknownArtist as never)).toEqual({ ok: false, reason: 'author-unresolved' });

    const noLicence = pageByTitle('Fort Dansborg.JPG');
    delete noLicence.imageinfo[0]!.extmetadata.LicenseShortName;
    expect(resolvePage(noLicence as never)).toEqual({ ok: false, reason: 'licence-unresolved' });

    const noUrl = pageByTitle('Fort Dansborg.JPG');
    delete noUrl.imageinfo[0]!.extmetadata.LicenseUrl;
    expect(resolvePage(noUrl as never)).toEqual({ ok: false, reason: 'licence-url-unresolved' });
  });
  it('reports files missing from the response', () => {
    expect(resolveImages(['Not there.jpg'], payload(response)).get('Not there.jpg')).toEqual({ ok: false, reason: 'file-not-found' });
    expect(resolvePage({ title: 'File:X.jpg', missing: '' })).toEqual({ ok: false, reason: 'file-not-found' });
  });
});

describe('Commons helpers', () => {
  it('strips HTML and decodes entities in attribution strings', () => {
    expect(stripHtml('<a href="//commons.wikimedia.org/wiki/User:X" title="User:X">X &amp; Y</a>&#32;<span>(talk)</span>')).toBe('X & Y (talk)');
  });
  it('removes utm tracking parameters', () => {
    expect(cleanUrl('https://upload.wikimedia.org/a.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo')).toBe(
      'https://upload.wikimedia.org/a.jpg',
    );
  });
  it('batches at most 50 sorted unique titles per request', () => {
    const files = Array.from({ length: 120 }, (_, i) => `File ${String(i).padStart(3, '0')}.jpg`);
    const batches = buildCommonsBatches(getSource(config, 'commons'), [...files, files[0]!].reverse());
    expect(batches.map((b) => b.titles.length)).toEqual([50, 50, 20]);
    expect(batches[0]!.titles[0]).toBe('File 000.jpg');
    expect(batches.map((b) => b.request.name)).toEqual(['batch-001', 'batch-002', 'batch-003']);
    const url = new URL(batches[0]!.request.url);
    expect(url.searchParams.get('iiprop')).toBe('url|extmetadata');
    expect(url.searchParams.get('iiextmetadatafilter')).toBe('LicenseShortName|LicenseUrl|Artist|Credit');
    expect(url.searchParams.get('titles')!.split('|')[0]).toBe('File:File 000.jpg');
  });
});
