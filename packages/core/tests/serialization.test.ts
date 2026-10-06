import { describe, expect, it } from 'vitest';
import {
  deserializeDocument,
  runMigrations,
  serializeDocument,
  FORMAT_VERSION,
  type EditorDocument,
  type Migration,
} from '@limber/core';
import { makeBone, makeSkeletonData } from './helpers';

function makeDocument(): EditorDocument {
  return {
    skeleton: {
      bones: [makeBone('root', null, { x: 10 }), makeBone('child', 'root', { rotation: 0.5 })],
      slots: [
        { id: 'slotA', name: 'slotA', boneId: 'root', defaultAttachmentId: 'att1', color: 0xff0000ff },
      ],
      attachments: [
        {
          id: 'att1',
          name: 'att1',
          type: 'region',
          textureId: 'tex1',
          vertices: [-10, -10, 10, -10, 10, 10, -10, 10],
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        },
      ],
      ikConstraints: [],
      skins: [{ name: 'default', attachments: { slotA: 'att1' } }],
      activeSkin: 'default',
    },
    animations: [
      {
        name: 'walk',
        duration: 1.5,
        loop: true,
        timelines: [
          {
            kind: 'boneProperty',
            boneId: 'child',
            property: 'rotation',
            keyframes: [
              { time: 0, value: 0, curve: { type: 'linear' } },
              { time: 0.5, value: 1.2, curve: { type: 'bezier', c1: 0.25, c2: 0.1, c3: 0.75, c4: 1.4 } },
              { time: 1.5, value: 0, curve: { type: 'stepped' } },
            ],
          },
          {
            kind: 'drawOrder',
            keyframes: [{ time: 0, slotOrder: [0], curve: { type: 'stepped' } }],
          },
        ],
      },
    ],
    assetManifest: {
      tex1: { name: 'head.png', source: 'embedded' },
    },
  };
}

describe('serializeDocument / deserializeDocument', () => {
  it('round-trips a full document unchanged', () => {
    const doc = makeDocument();
    const restored = deserializeDocument(serializeDocument(doc));
    expect(restored).toEqual(doc);
  });

  it('writes the current format version at the top level', () => {
    const parsed = JSON.parse(serializeDocument(makeDocument()));
    expect(parsed.version).toBe(FORMAT_VERSION);
  });

  it('produces JSON the Skeleton accepts (validates the round trip structurally)', async () => {
    const { Skeleton } = await import('@limber/core');
    const restored = deserializeDocument(serializeDocument(makeDocument()));
    expect(() => new Skeleton(restored.skeleton)).not.toThrow();
  });

  it('rejects documents from a newer format version', () => {
    const json = serializeDocument(makeDocument());
    const future = JSON.parse(json);
    future.version = FORMAT_VERSION + 1;
    expect(() => deserializeDocument(JSON.stringify(future))).toThrow(/newer than the supported version/);
  });

  it('loads a v1 document under format v2 (meshHull is additive)', () => {
    const legacy = JSON.parse(serializeDocument(makeDocument()));
    legacy.version = 1;
    const restored = deserializeDocument(JSON.stringify(legacy));
    // The migration chain stamps v1 → v2 without touching the payload.
    expect(restored).toEqual(makeDocument());
  });

  it('rejects documents without a version field', () => {
    const json = serializeDocument(makeDocument());
    const noVersion = JSON.parse(json);
    delete noVersion.version;
    expect(() => deserializeDocument(JSON.stringify(noVersion))).toThrow(/missing a numeric "version"/);
  });

  it('rejects invalid JSON and non-object documents with clear messages', () => {
    expect(() => deserializeDocument('{not json')).toThrow(/Not a valid JSON document/);
    expect(() => deserializeDocument('[1,2,3]')).toThrow(/must be a JSON object/);
  });

  it('rejects documents missing required skeleton arrays', () => {
    const doc = makeDocument();
    const broken = { version: FORMAT_VERSION, skeleton: { bones: [] }, animations: [], assetManifest: {} };
    void doc;
    expect(() => deserializeDocument(JSON.stringify(broken))).toThrow(/missing the "slots" array/);
  });
});

describe('runMigrations', () => {
  it('applies the migration chain in order and stamps each version', () => {
    const m1: Migration = (doc) => ({ ...doc, v1applied: true });
    const m2: Migration = (doc) => ({ ...doc, v2applied: true });
    const result = runMigrations({ version: 1 }, [m1, m2], 3);
    expect(result.version).toBe(3);
    expect(result.v1applied).toBe(true);
    expect(result.v2applied).toBe(true);
  });

  it('does nothing when already at the target version', () => {
    const result = runMigrations({ version: 3, untouched: 1 }, [], 3);
    expect(result.version).toBe(3);
    expect(result.untouched).toBe(1);
  });

  it('throws when a migration step is missing', () => {
    expect(() => runMigrations({ version: 1 }, [], 2)).toThrow(/No migration path from version 1 to 2/);
  });

  it('throws on a document with no valid version', () => {
    expect(() => runMigrations({}, [], 1)).toThrow(/no valid version/);
  });
});
