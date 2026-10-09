import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activeRigDocument,
  deserializeDocument,
  deserializeProject,
  projectFromLegacy,
  sceneTransform,
  serializeProject,
  validateProject,
  type GroupNode,
} from '@limber/core';
import { makeBone, makeSkeletonData } from './helpers';

const fixture = readFileSync(new URL('../../../fixtures/limber-v2-demo.json', import.meta.url), 'utf8');
const fresh = () =>
  projectFromLegacy({
    skeleton: makeSkeletonData([makeBone('root', null)]),
    animations: [],
    assetManifest: {},
  });
const group = (id: string, parentId: string | null = null): GroupNode => ({
  id,
  parentId,
  type: 'group',
  name: id,
  transform: sceneTransform(),
  visible: true,
  opacity: 1,
});

describe('BoneByBone project compatibility', () => {
  it('migrates the immutable first native schema fixture without changing its content', () => {
    const json = readFileSync(new URL('../../../fixtures/bbbproj-v1-demo.json', import.meta.url), 'utf8');
    expect(deserializeProject(json)).toEqual({ ...JSON.parse(json), schemaVersion: 5 });
  });
  it('migrates the immutable legacy demo without changing any rig, animation or asset data', () => {
    const legacy = deserializeDocument(fixture);
    const project = deserializeProject(fixture, 'Demo');
    expect(project.format).toBe('bonebybone-project');
    expect(project.name).toBe('Demo');
    expect(activeRigDocument(project)).toEqual(legacy);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });

  it('keeps v1 import working and does not mutate its source object', () => {
    const legacy = JSON.parse(fixture);
    legacy.version = 1;
    const project = deserializeProject(JSON.stringify(legacy));
    const source = activeRigDocument(project)!;
    const clone = projectFromLegacy(source);
    activeRigDocument(clone)!.skeleton.bones[0]!.name = 'Changed';
    expect(source.skeleton.bones[0]!.name).not.toBe('Changed');
    expect(legacy.version).toBe(1);
  });

  it('preserves multiple artboards, image/group nodes and stable IDs through save/load', () => {
    const project = fresh();
    project.assetManifest.texture = {
      name: 'panel.png',
      source: 'embedded',
      dataUrl: 'data:image/png;base64,AAAA',
    };
    project.artboards.push({
      id: 'ui',
      name: 'UI',
      width: 640,
      height: 480,
      nodes: [
        group('container'),
        { ...group('image', 'container'), type: 'image', textureId: 'texture', width: 120, height: 80 },
      ],
    });
    const copy = deserializeProject(serializeProject(project));
    expect(copy).toEqual(project);
    copy.artboards[1]!.nodes[0]!.name = 'Renamed';
    expect(copy.artboards[1]!.nodes[1]!.parentId).toBe('container');
  });

  it('provides a reference-backed active rig view so legacy edits are saved', () => {
    const project = fresh();
    activeRigDocument(project)!.skeleton.bones[0]!.setupPose.x = 123;
    const loaded = deserializeProject(serializeProject(project));
    expect(activeRigDocument(loaded)!.skeleton.bones[0]!.setupPose.x).toBe(123);
  });

  it('rejects future, fractional and nonnumeric schema versions', () => {
    for (const schemaVersion of [6, 0, 1.1, '1']) {
      expect(() => deserializeProject(JSON.stringify({ ...fresh(), schemaVersion }))).toThrow(/unsupported/);
    }
  });

  it('rejects runtime files and malformed JSON explicitly', () => {
    expect(() => deserializeProject('{')).toThrow(/valid JSON/);
    expect(() => deserializeProject('[]')).toThrow(/object/);
    expect(() => deserializeProject(JSON.stringify({ ...fresh(), format: 'bonebybone-runtime' }))).toThrow(
      /authoring project/,
    );
  });

  it('rejects duplicate IDs, unknown nodes and broken active selection', () => {
    const project = fresh();
    project.artboards[0]!.nodes.push(group(project.artboards[0]!.nodes[0]!.id));
    expect(() => validateProject(project)).toThrow(/Duplicate ID/);
    const wrongNode = fresh();
    Object.assign(wrongNode.artboards[0]!.nodes[0]!, { type: 'unknown-node' });
    expect(() => validateProject(wrongNode)).toThrow(/Unsupported scene node/);
    const missing = fresh();
    missing.editor.activeRigId = 'missing';
    expect(() => validateProject(missing)).toThrow(/Active rig/);
  });

  it('rejects parent cycles and references outside the artboard', () => {
    const project = fresh();
    project.artboards[0]!.nodes.push(group('a', 'b'), group('b', 'a'));
    expect(() => validateProject(project)).toThrow(/cycle/);
    project.artboards[0]!.nodes.pop();
    expect(() => validateProject(project)).toThrow(/parent/);
  });

  it('validates deep hierarchies without recursive stack overflow', () => {
    const project = fresh();
    for (let i = 0; i < 10000; i++) project.artboards[0]!.nodes.push(group(`g${i}`, i ? `g${i - 1}` : null));
    expect(() => validateProject(project)).not.toThrow();
  });

  it('rejects invalid transforms, dimensions, visibility and missing assets', () => {
    const project = fresh();
    project.artboards[0]!.nodes[0]!.transform.x = NaN;
    expect(() => serializeProject(project)).toThrow(/finite/);
    project.artboards[0]!.nodes[0]!.transform.x = 0;
    project.artboards[0]!.width = 0;
    expect(() => validateProject(project)).toThrow(/width/);
    project.artboards[0]!.width = 100;
    project.artboards[0]!.nodes.push({
      ...group('image'),
      type: 'image',
      textureId: 'missing',
      width: 10,
      height: 10,
    });
    expect(() => validateProject(project)).toThrow(/missing asset/);
  });
});
