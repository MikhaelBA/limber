import type { RuntimeFeature, RuntimeLogicGraph, RuntimeProgram } from './model';

export function deriveRuntimeFeatures(program: RuntimeProgram): RuntimeFeature[] {
  const features = new Set<RuntimeFeature>(['scene']);
  if (program.textures.some((texture) => texture.type === 'atlas')) features.add('atlas');
  if (program.fonts.length) features.add('fonts');
  const graph = (graph: RuntimeLogicGraph | undefined) => {
    if (!graph) return;
    features.add('logic');
    if (graph.bindings?.length) features.add('logic-bindings');
    if (graph.routes?.length) features.add('logic-routes');
  };
  if (program.components.length) features.add('ui-components');
  for (const container of [...program.artboards, ...program.components]) {
    if ('clips' in container && container.clips?.length) {
      features.add('scene-motion');
      if (container.clips.some((clip) => clip.events.some((event) => typeof event.payload === 'object')))
        features.add('typed-events');
    }
    if ('logic' in container) graph(container.logic);
    for (const node of container.nodes) {
      if (node.layout) features.add('ui-layout');
      if (node.type === 'text') features.add('ui-text');
      if (node.type === 'nineSlice') features.add('ui-nine-slice');
      if (node.type === 'mask') features.add('ui-masks');
      if (node.type === 'instance') features.add('ui-components');
      if (node.type !== 'rig') continue;
      features.add('rig');
      graph(node.logic);
      const s = node.skeleton;
      if (s.attachments.some((a) => a.type === 'mesh')) features.add('rig-mesh');
      if (s.attachments.some((a) => a.meshSourceId !== undefined)) features.add('rig-shared-mesh');
      if (s.attachments.some((a) => a.type === 'clipping')) features.add('rig-clipping');
      if (s.skins.length) features.add('rig-skins');
      if (s.markers?.length) features.add('rig-markers');
      if (s.ikConstraints.length) features.add('rig-ik');
      if (s.transformConstraints?.length) features.add('rig-transform');
      if (s.paths?.length || s.pathConstraints?.length) features.add('rig-path');
      if (s.secondaryConstraints?.length) features.add('rig-secondary');
      for (const animation of node.animations)
        for (const timeline of animation.timelines) {
          if (timeline.kind === 'deform') features.add('rig-deform');
          if (timeline.kind === 'event' && timeline.keyframes.some((key) => typeof key.payload === 'object'))
            features.add('typed-events');
        }
    }
  }
  return [...features].sort();
}

export function referencedRuntimeTextures(
  program: Pick<RuntimeProgram, 'artboards' | 'components'>,
): Set<string> {
  const ids = new Set<string>();
  for (const container of [...program.artboards, ...program.components])
    for (const node of container.nodes) {
      if (node.type === 'image' || node.type === 'nineSlice') ids.add(node.textureId);
      if (node.type === 'rig')
        for (const attachment of node.skeleton.attachments)
          if (attachment.textureId) ids.add(attachment.textureId);
    }
  return ids;
}

/** These users sample authored full-domain UVs and must not receive cropped textures. */
export function fullDomainRuntimeTextures(
  program: Pick<RuntimeProgram, 'artboards' | 'components'>,
): Set<string> {
  const ids = new Set<string>();
  for (const container of [...program.artboards, ...program.components])
    for (const node of container.nodes) {
      if (node.type === 'nineSlice') ids.add(node.textureId);
      if (node.type === 'rig')
        for (const attachment of node.skeleton.attachments)
          if (attachment.textureId) ids.add(attachment.textureId);
    }
  return ids;
}
