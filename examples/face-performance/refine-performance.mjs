// Acting edits reuse the original generated pixels and the existing weight solver.
const smooth = { type: 'bezier', c1: 0.25, c2: 0, c3: 0.65, c4: 1 };
const stepped = { type: 'stepped' };
const track = (boneId, property, keys) => ({
  kind: 'boneProperty',
  boneId,
  property,
  keyframes: keys.map(([time, value]) => ({ time, value, curve: smooth })),
});
const colorTrack = (slotId, keys) => ({
  kind: 'slotColor',
  slotId,
  keyframes: keys.map(([time, alpha]) => ({
    time,
    value: (0xffffff00 | Math.round(alpha * 255)) >>> 0,
    curve: { type: 'linear' },
  })),
});

export function refinePerformance(skeleton, animations) {
  const featureSlots = skeleton.slots.filter((slot) => /visemes|lids|expression/.test(slot.id));
  const copies = new Map();
  for (const slot of featureSlots) {
    const overlayId = `${slot.id} — blend`;
    skeleton.slots.splice(skeleton.slots.indexOf(slot) + 1, 0, {
      ...slot,
      id: overlayId,
      name: overlayId,
      defaultAttachmentId: null,
      color: 0xffffff00,
    });
    // Each layer owns its attachment cache, with identical frozen bindings/weights.
    const prefix = slot.id.startsWith('Mouth')
      ? 'Mouth '
      : slot.id.startsWith('Eye')
        ? `${slot.id.slice(0, 5)} `
        : `${slot.id.slice(0, 6)} `;
    const ids = new Map();
    for (const attachment of skeleton.attachments.filter((a) => a.id.startsWith(prefix))) {
      const copy = structuredClone(attachment);
      copy.id = `${attachment.id} — blend`;
      copy.name = copy.id;
      skeleton.attachments.push(copy);
      ids.set(attachment.id, copy.id);
    }
    copies.set(slot.id, { overlayId, ids });
  }
  for (const clip of animations) {
    const refined = [];
    for (const timeline of clip.timelines) {
      const copy = timeline.kind === 'slotAttachment' ? copies.get(timeline.slotId) : null;
      if (!copy) {
        refined.push(timeline);
        continue;
      }
      const first = timeline.keyframes[0].attachmentId;
      const attachments = [
        [{ time: 0, attachmentId: first, curve: stepped }],
        [{ time: 0, attachmentId: null, curve: stepped }],
      ];
      const alphas = [[[0, 1]], [[0, 0]]];
      let active = 0,
        previous = first;
      for (const key of timeline.keyframes.slice(1)) {
        if (key.attachmentId === previous || key.time >= clip.duration) continue;
        const next = 1 - active;
        const width = timeline.slotId.startsWith('Eye')
          ? 0.035
          : timeline.slotId.startsWith('Brow')
            ? 0.12
            : 0.065;
        const end = Math.min(key.time + width, clip.duration);
        attachments[next].push({
          time: key.time,
          attachmentId: next === 1 ? copy.ids.get(key.attachmentId) : key.attachmentId,
          curve: stepped,
        });
        alphas[active].push([key.time, 1], [end, 0]);
        alphas[next].push([key.time, 0], [end, 1]);
        active = next;
        previous = key.attachmentId;
      }
      for (const layer of [0, 1]) {
        const slotId = layer === 0 ? timeline.slotId : copy.overlayId;
        refined.push(
          { kind: 'slotAttachment', slotId, keyframes: attachments[layer] },
          colorTrack(slotId, alphas[layer]),
        );
      }
    }
    clip.timelines = refined;
  }
  const getClip = (name) => animations.find((a) => a.name === name);
  const replace = (clip, boneId, property, keys) => {
    clip.timelines = clip.timelines.filter(
      (t) => !(t.kind === 'boneProperty' && t.boneId === boneId && t.property === property),
    );
    clip.timelines.push(track(boneId, property, keys));
  };
  const talking = getClip('Talking');
  // Jaw starts ahead of a viseme and arrives after it; lip rounding has its own timing.
  const sequence = [
    [0, 'Rest'],
    [0.18, 'AH'],
    [0.35, 'EE'],
    [0.53, 'OH'],
    [0.72, 'Rest'],
    [0.95, 'OO'],
    [1.1, 'AH'],
    [1.28, 'EE'],
    [1.43, 'MBP'],
    [1.57, 'AH'],
    [1.74, 'Rest'],
    [2.05, 'MBP'],
    [2.15, 'OH'],
    [2.37, 'EE'],
    [2.52, 'Rest'],
    [2.68, 'FV'],
    [2.85, 'AH'],
    [3.05, 'MBP'],
    [3.14, 'AH'],
    [3.33, 'EE'],
    [3.48, 'Rest'],
    [4, 'Rest'],
  ];
  const opening = { Rest: 0, AH: 5.5, EE: 1.7, OH: 4.3, OO: 1.5, FV: 0.4, MBP: -0.4 };
  const width = { Rest: 1, AH: 1.025, EE: 1.09, OH: 0.97, OO: 0.9, FV: 1.015, MBP: 1.01 };
  replace(
    talking,
    'jaw',
    'y',
    sequence.map(([t, shape], i) => [i === 0 || t === 4 ? t : t + 0.045, -55 + opening[shape]]),
  );
  for (const side of ['L', 'R'])
    replace(
      talking,
      `lip-${side}`,
      'x',
      sequence.map(([t, shape], i) => [
        i === 0 || t === 4 ? t : t - 0.035,
        (side === 'L' ? -42 : 42) * width[shape],
      ]),
    );
  replace(talking, 'brow-R', 'y', [
    [0, -205],
    [0.31, -208],
    [1.46, -205],
    [2.23, -209],
    [2.75, -205],
    [4, -205],
  ]);
  const crying = getClip('Crying');
  replace(crying, 'jaw', 'y', [
    [0, -55],
    [0.82, -53],
    [1.24, -49.5],
    [1.45, -54],
    [1.61, -51.5],
    [1.94, -54.5],
    [2.42, -49],
    [2.68, -53.5],
    [3.07, -52],
    [3.61, -50.5],
    [3.86, -54],
    [4.45, -53],
    [5, -55],
  ]);
  replace(crying, 'head', 'rotation', [
    [0, 0],
    [0.73, 0.045],
    [1.38, 0.065],
    [1.7, 0.056],
    [2.26, 0.08],
    [2.74, 0.071],
    [3.48, 0.055],
    [4.25, 0.032],
    [5, 0],
  ]);
  replace(crying, 'lip-R', 'y', [
    [0, -83],
    [0.5, -77],
    [1.27, -75],
    [1.78, -77.5],
    [2.48, -75.5],
    [3.2, -76],
    [4.22, -78],
    [5, -83],
  ]);
  // Reset tears only while fully transparent; each side has a different fall cadence.
  for (const side of ['L', 'R']) {
    const slotId = `Tear ${side} — drops`,
      boneId = `tear-${side}`;
    crying.timelines = crying.timelines.filter(
      (t) =>
        !(t.kind === 'slotAttachment' && t.slotId === slotId) &&
        !(t.kind === 'boneProperty' && t.boneId === boneId && t.property === 'y'),
    );
    const starts = side === 'L' ? [0.75, 2.15, 3.46] : [1.23, 2.84];
    const position = [[0, -149]],
      alpha = [[0, 0]];
    for (const [i, start] of starts.entries()) {
      const end = start + (side === 'L' ? 0.93 : 1.06);
      position.push([start, -149], [end, -94 - i * 3], [end + 0.04, -149]);
      alpha.push([start, 0], [start + 0.12, 0.85], [end - 0.16, 0.8], [end, 0], [end + 0.04, 0]);
    }
    position.push([5, -149]);
    alpha.push([5, 0]);
    const fall = track(boneId, 'y', position);
    for (const key of fall.keyframes)
      if (starts.some((start) => Math.abs(key.time - start - (side === 'L' ? 0.93 : 1.06)) < 1e-6))
        key.curve = stepped;
    crying.timelines.push(fall, colorTrack(slotId, alpha), {
      kind: 'slotAttachment',
      slotId,
      keyframes: [{ time: 0, attachmentId: `Tear ${side}`, curve: stepped }],
    });
  }
  const laughing = getClip('Laughing');
  replace(laughing, 'jaw', 'y', [
    [0, -55],
    [0.52, -52],
    [0.76, -44],
    [0.97, -50],
    [1.16, -45],
    [1.4, -51],
    [1.66, -46.5],
    [1.84, -50.5],
    [2.14, -47.5],
    [2.51, -52],
    [2.72, -49],
    [3.25, -54.5],
    [4, -55],
  ]);
  replace(laughing, 'head', 'y', [
    [0, 155],
    [0.63, 153.5],
    [0.91, 154.7],
    [1.31, 152.8],
    [1.61, 154.6],
    [2.02, 153.5],
    [2.46, 154.2],
    [3.25, 155],
    [4, 155],
  ]);
  replace(laughing, 'head', 'rotation', [
    [0, 0],
    [0.72, -0.045],
    [1.2, -0.019],
    [1.73, -0.052],
    [2.28, -0.027],
    [2.65, -0.036],
    [3.4, 0.012],
    [4, 0],
  ]);
  replace(laughing, 'cheek-R', 'y', [
    [0, -115],
    [0.68, -120],
    [2.76, -120],
    [3.53, -115],
    [4, -115],
  ]);
  // Avoid mechanical perfectly simultaneous eyelid closures.
  for (const clip of animations)
    for (const timeline of clip.timelines) {
      if (!timeline.slotId?.startsWith('Eye R')) continue;
      for (const key of timeline.keyframes)
        if (key.time > 0 && key.time < clip.duration)
          key.time = Math.min(clip.duration - 0.001, key.time + 0.012);
    }
}
