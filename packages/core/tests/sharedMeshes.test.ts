import { PROJECT_SCHEMA_VERSION } from '../src/project/model';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Skeleton, deserializeProject, serializeProject, activeRigDocument, exportSpineJson,
  serializeDocument, deserializeDocument, validateDeformTimelines, resolveMeshLinks } from '../src';
import { RuntimePlayer } from '../../runtime/src';

const fixture = () => deserializeProject(readFileSync('fixtures/bbbproj-v6-shared-mesh.json', 'utf8'));
describe('shared mesh geometry with independent runtime state', () => {
  it('bakes one geometry but evaluates independent weights, bindings and deform caches', () => {
    const doc = activeRigDocument(fixture())!, skeleton = new Skeleton(doc.skeleton);
    const [source, link] = skeleton.data.attachments;
    expect(link!.meshVertices).toBe(source!.meshVertices);
    expect(link!.meshUVs).toBe(source!.meshUVs);
    expect(link!.weights).not.toBe(source!.weights);
    expect(link!.boneBindings).not.toBe(source!.boneBindings);
    expect(skeleton.pose.attachments.get('mesh')).not.toBe(skeleton.pose.attachments.get('variant'));
    const player = new RuntimePlayer(doc);
    player.setAnimation(doc.animations[0]!.name, { loop: false }); for (let i = 0; i < 5; i++) player.update(0.1);
    expect([...player.getDeformedVertices('mesh')!]).toEqual([-20,80,80,80,80,240,-20,240]);
    expect([...player.getDeformedVertices('variant')!]).toEqual([-50,90,50,90,50,250,-50,250]);
    expect(link!.meshVertices!.slice(0, 2)).toEqual([-50, 80]);
  });
  it('stores geometry once and roundtrips native and rig files without derived field drift', () => {
    const project = fixture(), doc = activeRigDocument(project)!;
    new Skeleton(doc.skeleton);
    const native = serializeProject(project), raw = JSON.parse(native);
    expect(raw.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(raw.artboards[0].nodes[0].skeleton.attachments[1].meshVertices).toBeUndefined();
    expect(serializeProject(deserializeProject(native))).toBe(native);
    const rig = serializeDocument(doc);
    expect(JSON.parse(rig).skeleton.attachments[1].meshUVs).toBeUndefined();
    const reopened = deserializeDocument(rig); validateDeformTimelines(reopened.skeleton, reopened.animations);
    new Skeleton(reopened.skeleton);
    expect(serializeDocument(reopened)).toBe(rig);
    expect(() => exportSpineJson(doc)).toThrow(/shared meshes/);
  });
  it.each(['missing', 'variant', 'region', 'chain'])('rejects %s sources before installing aliases', (id) => {
    const data = activeRigDocument(fixture())!.skeleton;
    data.attachments.push({ id: 'region', name: 'region', type: 'region', textureId: '', vertices: [0,0,1,0,1,1,0,1], uvs: [0,0,1,0,1,1,0,1] });
    data.attachments.push({ id: 'chain', name: 'chain', type: 'mesh', textureId: '', meshSourceId: 'mesh' });
    data.attachments[1]!.meshSourceId = id;
    expect(() => resolveMeshLinks(data)).toThrow(/shared mesh source/);
    expect(data.attachments[2]!.meshVertices).toBeUndefined();
  });
  it('rejects conflicting duplicated geometry and malformed independent influence/deform data', () => {
    const data = activeRigDocument(fixture())!.skeleton;
    data.attachments[1]!.meshVertices = [0, 0];
    expect(() => new Skeleton(data)).toThrow(/conflicting geometry/);
    data.attachments[1]!.meshVertices = [...data.attachments[0]!.meshVertices!];
    delete data.attachments[1]!.meshVertices![0];
    expect(() => new Skeleton(data)).toThrow(/conflicting geometry/);
    delete data.attachments[1]!.meshVertices;
    data.attachments[1]!.weights!.pop();
    expect(() => new Skeleton(data)).toThrow(/malformed weights/);
    const doc = activeRigDocument(fixture())!;
    const track = doc.animations[0]!.timelines.find((item) => item.kind === 'deform')!;
    if (track.kind === 'deform') track.keyframes[1]!.offsets!.pop();
    expect(() => validateDeformTimelines(doc.skeleton, doc.animations)).toThrow(/Invalid Deform/);
  });
});
