import { RuntimeFrameProfiler, type RuntimeFrameSample } from '@limber/runtime';
import type { NativeWebRenderer } from './NativeWebRenderer';

type GL = WebGLRenderingContext | WebGL2RenderingContext;
const active = new WeakSet<GL>();
/** Actual native core WebGL2 API draw submissions, including masks; other paths remain unknown. */
export function measureWebGLDrawCalls(gl: GL | undefined, render: () => void): number | null {
  if (!gl || active.has(gl)) {
    render();
    return null;
  }
  const context = gl as unknown as Record<string, unknown>,
    names = [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
      'drawRangeElements',
    ],
    restores: (() => void)[] = [];
  if (
    typeof context.drawArrays !== 'function' ||
    typeof context.drawElements !== 'function' ||
    typeof context.drawArraysInstanced !== 'function' ||
    typeof context.drawElementsInstanced !== 'function'
  ) {
    render();
    return null;
  }
  let count = 0,
    instrumented = true;
  active.add(gl);
  const restore = () => {
    for (const undo of restores.reverse()) undo();
    active.delete(gl);
  };
  try {
    for (const name of names) {
      const method = context[name];
      if (typeof method !== 'function') continue;
      const descriptor = Object.getOwnPropertyDescriptor(gl, name);
      Object.defineProperty(gl, name, {
        configurable: true,
        writable: true,
        value: function (...args: unknown[]) {
          count++;
          return Reflect.apply(method, gl, args);
        },
      });
      restores.push(() => {
        if (descriptor) Object.defineProperty(gl, name, descriptor);
        else delete context[name];
      });
    }
  } catch {
    instrumented = false;
    restore();
  }
  try {
    render();
    return instrumented ? count : null;
  } finally {
    if (instrumented) restore();
  }
}
/** CPU update (including adapter synchronization) and CPU render submission, never GPU elapsed time. */
export class NativeWebFrameProfiler {
  constructor(
    readonly view: NativeWebRenderer,
    readonly frames = new RuntimeFrameProfiler(),
  ) {}
  run(delta: number, render: () => void, gl?: GL): RuntimeFrameSample {
    const started = performance.now(),
      acceptedTicks = this.view.update(delta),
      updated = performance.now(),
      drawCalls = measureWebGLDrawCalls(gl, render),
      ended = performance.now();
    const sample = { updateMs: updated - started, renderSubmitMs: ended - updated, acceptedTicks, drawCalls };
    this.frames.record(sample);
    return sample;
  }
}
