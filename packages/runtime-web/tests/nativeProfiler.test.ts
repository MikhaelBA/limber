import { describe, expect, it } from 'vitest';
import { measureWebGLDrawCalls } from '../src/NativeWebProfiler';

describe('temporary WebGL core draw instrumentation', () => {
  it('counts calls with original receiver/arguments/return, restoring inherited and own methods', () => {
    let invoked = 0;
    const proto = {
      drawArrays(this: unknown, ...args: unknown[]) {
        expect(this).toBe(gl);
        expect(args).toEqual([1, 2, 3]);
        invoked++;
        return 42;
      },
    };
    const gl = Object.assign(Object.create(proto), {
      drawArraysInstanced() {},
      drawElementsInstanced() {},
      drawElements() {
        invoked++;
      },
    });
    const descriptor = Object.getOwnPropertyDescriptor(gl, 'drawElements');
    expect(
      measureWebGLDrawCalls(gl, () => {
        expect(gl.drawArrays(1, 2, 3)).toBe(42);
        gl.drawElements();
      }),
    ).toBe(2);
    expect(invoked).toBe(2);
    expect(Object.hasOwn(gl, 'drawArrays')).toBe(false);
    expect(Object.getOwnPropertyDescriptor(gl, 'drawElements')).toEqual(descriptor);
    expect(() =>
      measureWebGLDrawCalls(gl, () => {
        gl.drawElements();
        throw new Error('render failure');
      }),
    ).toThrow('render failure');
    expect(Object.getOwnPropertyDescriptor(gl, 'drawElements')).toEqual(descriptor);
    expect(measureWebGLDrawCalls(gl, () => {})).toBe(0);
  });
  it('preserves unknown backends, nested collection and atomic instrumentation refusal', () => {
    let calls = 0;
    expect(measureWebGLDrawCalls(undefined, () => calls++)).toBe(null);
    const gl = {
      drawArraysInstanced() {},
      drawElementsInstanced() {},
      drawArrays() {
        calls++;
      },
      drawElements() {
        calls++;
      },
    };
    expect(
      measureWebGLDrawCalls(gl as never, () => {
        expect(measureWebGLDrawCalls(gl as never, () => gl.drawElements())).toBe(null);
        gl.drawArrays();
      }),
    ).toBe(2);
    const own = Object.getOwnPropertyDescriptor(gl, 'drawArrays');
    Object.defineProperty(gl, 'drawElements', { configurable: false });
    expect(measureWebGLDrawCalls(gl as never, () => gl.drawArrays())).toBe(null);
    expect(Object.getOwnPropertyDescriptor(gl, 'drawArrays')).toEqual(own);
    expect(calls).toBe(4);
  });
});
