import type { Graphics } from 'pixi.js';
import { distToSegment } from '../math/matrix';
import { unit, type Point } from '../math/rigGesture';

export type RigHandle = 'x' | 'y' | 'free' | 'ring';
export interface Gizmo {
  origin: Point;
  x: Point;
  y: Point;
  free: Point;
  radius: number;
}

export function rigGizmo(m: ArrayLike<number>, scale: number, tool: string): Gizmo {
  const origin = { x: m[4]!, y: m[5]! },
    distance = 64 / scale;
  const xAxis = tool === 'translate' ? { x: 1, y: 0 } : unit({ x: m[0]!, y: m[1]! });
  const yAxis = tool === 'translate' ? { x: 0, y: -1 } : unit({ x: m[2]!, y: m[3]! });
  return {
    origin,
    x: { x: origin.x + xAxis.x * distance, y: origin.y + xAxis.y * distance },
    y: { x: origin.x + yAxis.x * distance, y: origin.y + yAxis.y * distance },
    free: {
      x: origin.x + (xAxis.x + yAxis.x) * distance * 0.55,
      y: origin.y + (xAxis.y + yAxis.y) * distance * 0.55,
    },
    radius: 42 / scale,
  };
}

export function pickRigHandle(g: Gizmo, p: Point, scale: number, tool: string): RigHandle | null {
  const near = (v: Point) => Math.hypot(p.x - v.x, p.y - v.y) < 10 / scale;
  if (tool === 'rotate')
    return Math.abs(Math.hypot(p.x - g.origin.x, p.y - g.origin.y) - g.radius) < 7 / scale ? 'ring' : null;
  if (tool === 'shear') return near(g.y) ? 'y' : null;
  if (tool !== 'translate' && tool !== 'scale') return null;
  if (near(g.free)) return 'free';
  for (const axis of ['x', 'y'] as const) {
    if (near(g[axis])) return axis;
    // Leave the centre available for freely moving a bone.
    const start = {
      x: g.origin.x + (g[axis].x - g.origin.x) * 0.3,
      y: g.origin.y + (g[axis].y - g.origin.y) * 0.3,
    };
    if (tool === 'translate' && distToSegment(p.x, p.y, start.x, start.y, g[axis].x, g[axis].y) < 6 / scale)
      return axis;
  }
  return null;
}

export function drawRigGizmo(graphics: Graphics, g: Gizmo, scale: number, tool: string): void {
  if (tool === 'shear') {
    graphics
      .moveTo(g.origin.x, g.origin.y)
      .lineTo(g.y.x, g.y.y)
      .stroke({ color: 0xc49aff, width: 2 / scale });
    graphics
      .poly([
        g.y.x,
        g.y.y - 6 / scale,
        g.y.x + 6 / scale,
        g.y.y,
        g.y.x,
        g.y.y + 6 / scale,
        g.y.x - 6 / scale,
        g.y.y,
      ])
      .fill({ color: 0xc49aff })
      .stroke({ color: 0x16191e, width: 1 / scale });
    return;
  }
  if (tool === 'rotate') {
    graphics.circle(g.origin.x, g.origin.y, g.radius).stroke({ color: 0xffbe45, width: 2 / scale });
    return;
  }
  if (tool !== 'translate' && tool !== 'scale') return;
  for (const [axis, color] of [
    ['x', 0xff6969],
    ['y', 0x69db82],
  ] as const) {
    const end = g[axis],
      dir = unit({ x: end.x - g.origin.x, y: end.y - g.origin.y });
    graphics
      .moveTo(g.origin.x, g.origin.y)
      .lineTo(end.x, end.y)
      .stroke({ color, width: 2 / scale });
    if (tool === 'scale')
      graphics
        .rect(end.x - 4 / scale, end.y - 4 / scale, 8 / scale, 8 / scale)
        .fill({ color })
        .stroke({ color: 0x16191e, width: 1 / scale });
    else
      graphics
        .poly([
          end.x,
          end.y,
          end.x - (dir.x * 9 + dir.y * 4) / scale,
          end.y - (dir.y * 9 - dir.x * 4) / scale,
          end.x - (dir.x * 9 - dir.y * 4) / scale,
          end.y - (dir.y * 9 + dir.x * 4) / scale,
        ])
        .fill({ color });
  }
  graphics
    .rect(g.free.x - 5 / scale, g.free.y - 5 / scale, 10 / scale, 10 / scale)
    .fill({ color: 0xffbe45, alpha: 0.8 })
    .stroke({ color: 0x16191e, width: 1 / scale });
}

export function drawRigBone(
  g: Graphics,
  origin: Point,
  tip: Point,
  scale: number,
  color: number,
  selected: boolean,
): void {
  const delta = { x: tip.x - origin.x, y: tip.y - origin.y },
    length = Math.hypot(delta.x, delta.y);
  if (length > 1 / scale) {
    const dir = unit(delta),
      width = Math.min(5 / scale, length * 0.12),
      shoulder = Math.min(14 / scale, length * 0.22);
    g.poly([
      origin.x,
      origin.y,
      origin.x + dir.x * shoulder - dir.y * width,
      origin.y + dir.y * shoulder + dir.x * width,
      tip.x,
      tip.y,
      origin.x + dir.x * shoulder + dir.y * width,
      origin.y + dir.y * shoulder - dir.x * width,
    ])
      .fill({ color, alpha: 0.13 })
      .stroke({ color, width: 1.5 / scale });
    g.circle(tip.x, tip.y, 3 / scale)
      .fill({ color: 0x202329 })
      .stroke({ color, width: 1.5 / scale });
  } else {
    g.poly([
      origin.x,
      origin.y - 8 / scale,
      origin.x + 8 / scale,
      origin.y,
      origin.x,
      origin.y + 8 / scale,
      origin.x - 8 / scale,
      origin.y,
    ]).stroke({ color, width: 1.5 / scale });
  }
  g.circle(origin.x, origin.y, (selected ? 6 : 4) / scale)
    .fill({ color: 0x202329, alpha: 0.8 })
    .stroke({ color, width: 2 / scale });
  if (selected) g.circle(origin.x, origin.y, 2 / scale).fill({ color });
}
