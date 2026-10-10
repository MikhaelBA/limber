import { describe, expect, it, vi } from 'vitest';
import { AtlasError, createAtlasWorkStats } from '@limber/atlas';
import { buildAtlasInWorker } from '../src/atlasJob';
import {
  validAtlasWorkerResult,
  type AtlasJobWorker,
  type AtlasWorkerMessage,
  type AtlasWorkerRequest,
  type AtlasWorkerResult,
} from '../src/atlasProtocol';
import { readRasterSize } from '../src/imageHeader';

const png = () =>
  Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  ).buffer;
const input = () => ({ images: [{ id: 'image', mime: 'image/png' as const, bytes: png() }] });
const result = (): AtlasWorkerResult => ({
  layout: {
    padding: 0,
    pages: [{ width: 1, height: 1 }],
    placements: [{ id: 'image', page: 0, x: 0, y: 0, width: 1, height: 1, rotated: false }],
  },
  regions: [
    {
      id: 'image',
      width: 1,
      height: 1,
      sourceWidth: 1,
      sourceHeight: 1,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      scale: 1,
      empty: false,
    },
  ],
  pages: [{ id: 'page-0', width: 1, height: 1, bytes: png(), mime: 'image/png', premultiplied: false }],
  stats: createAtlasWorkStats(),
  timingsMs: { decode: 1, prepare: 2, pack: 3, compose: 4, encode: 5, total: 15 },
});
class FakeWorker implements AtlasJobWorker {
  onmessage: AtlasJobWorker['onmessage'] = null;
  onerror: AtlasJobWorker['onerror'] = null;
  onmessageerror: AtlasJobWorker['onmessageerror'] = null;
  request!: AtlasWorkerRequest;
  terminate = vi.fn();
  postMessage(message: AtlasWorkerRequest) {
    this.request = structuredClone(message);
  }
  emit(
    message:
      | Omit<Extract<AtlasWorkerMessage, { kind: 'result' }>, 'id'>
      | Omit<Extract<AtlasWorkerMessage, { kind: 'progress' }>, 'id'>
      | Omit<Extract<AtlasWorkerMessage, { kind: 'error' }>, 'id'>,
    id = this.request.id,
  ) {
    this.onmessage?.({ data: { id, ...message } } as MessageEvent<AtlasWorkerMessage>);
  }
}
const cleaned = (worker: FakeWorker) => {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
};

describe('owned atlas worker publication', () => {
  it('rejects pre-abort without creating a worker; active abort rejects retained late delivery', async () => {
    const controller = new AbortController(),
      create = vi.fn(() => new FakeWorker());
    controller.abort();
    await expect(
      buildAtlasInWorker(input(), { createWorker: create, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).not.toHaveBeenCalled();
    const worker = new FakeWorker(),
      active = new AbortController(),
      progress = vi.fn();
    const job = buildAtlasInWorker(input(), { createWorker: () => worker, signal: active.signal, progress });
    const retained = worker.onmessage!;
    active.abort();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    retained({
      data: { id: worker.request.id, kind: 'progress', fraction: 1, stage: 'encode' },
    } as MessageEvent<AtlasWorkerMessage>);
    retained({
      data: { id: worker.request.id, kind: 'result', result: result() },
    } as MessageEvent<AtlasWorkerMessage>);
    expect(progress).not.toHaveBeenCalled();
    cleaned(worker);
  });
  it('captures original identities, ignores another job and publishes once', async () => {
    const worker = new FakeWorker(),
      source = input();
    const job = buildAtlasInWorker(source, { createWorker: () => worker });
    source.images[0]!.id = 'changed-in-editor';
    worker.emit({ kind: 'result', result: result() }, worker.request.id + 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    const retained = worker.onmessage!;
    worker.emit({ kind: 'result', result: result() });
    expect((await job).regions[0]!.id).toBe('image');
    retained({
      data: { id: worker.request.id, kind: 'result', result: result() },
    } as MessageEvent<AtlasWorkerMessage>);
    expect(worker.request.input.images[0]!.id).toBe('image');
    cleaned(worker);
  });
  it('rejects unrelated identities and malformed crop/page/work metadata', async () => {
    expect(validAtlasWorkerResult(result())).toBe(true);
    expect(validAtlasWorkerResult(null)).toBe(false);
    for (const mutate of [
      (r: AtlasWorkerResult) => {
        r.regions[0]!.id = r.layout.placements[0]!.id = 'another';
      },
      (r: AtlasWorkerResult) => {
        r.regions[0]!.crop.x = 1;
      },
      (r: AtlasWorkerResult) => {
        r.layout.placements[0]!.page = 0.5;
      },
      (r: AtlasWorkerResult) => {
        r.pages[0]!.width = 2;
      },
      (r: AtlasWorkerResult) => {
        r.stats.fitTests = NaN;
      },
      (r: AtlasWorkerResult) => {
        r.timingsMs.total = -1;
      },
      (r: AtlasWorkerResult) => {
        r.pages[0]!.bytes = new ArrayBuffer(0);
      },
    ]) {
      const r = result();
      mutate(r);
      const worker = new FakeWorker(),
        job = buildAtlasInWorker(input(), { createWorker: () => worker });
      worker.emit({ kind: 'result', result: r });
      await expect(job).rejects.toThrow(/atlas/i);
      cleaned(worker);
    }
  });
  it('enforces monotonic finite progress and handles a throwing host callback', async () => {
    for (const fraction of [-1, 1.1, NaN, 0.1]) {
      const worker = new FakeWorker(),
        job = buildAtlasInWorker(input(), { createWorker: () => worker });
      worker.emit({ kind: 'progress', stage: 'decode', fraction: 0.2 });
      worker.emit({ kind: 'progress', stage: 'decode', fraction });
      await expect(job).rejects.toThrow('Invalid atlas progress');
      cleaned(worker);
    }
    const worker = new FakeWorker(),
      job = buildAtlasInWorker(input(), {
        createWorker: () => worker,
        progress: () => {
          throw new Error('host failed');
        },
      });
    worker.emit({ kind: 'progress', stage: 'decode', fraction: 0 });
    await expect(job).rejects.toThrow('host failed');
    cleaned(worker);
  });
  it('preserves diagnostics and cleans up worker, clone, post and constructor failures', async () => {
    const worker = new FakeWorker(),
      job = buildAtlasInWorker(input(), { createWorker: () => worker });
    worker.emit({
      kind: 'error',
      code: 'SVG_DECODE',
      objectId: 'image',
      message: 'bad XML',
      remedy: 'Reimport SVG.',
    });
    await expect(job).rejects.toBeInstanceOf(AtlasError);
    await expect(job).rejects.toMatchObject({
      code: 'SVG_DECODE',
      objectId: 'image',
      remedy: 'Reimport SVG.',
    });
    cleaned(worker);
    for (const failure of ['error', 'clone', 'post']) {
      const worker = new FakeWorker();
      if (failure === 'post')
        worker.postMessage = () => {
          throw new Error('post failed');
        };
      const job = buildAtlasInWorker(input(), { createWorker: () => worker });
      if (failure === 'error') worker.onerror!({ message: 'worker failed' } as ErrorEvent);
      if (failure === 'clone') worker.onmessageerror!({} as MessageEvent);
      await expect(job).rejects.toThrow(/failed|cloned/);
      cleaned(worker);
    }
    await expect(
      buildAtlasInWorker(input(), {
        createWorker: () => {
          throw new Error('construction failed');
        },
      }),
    ).rejects.toThrow('construction failed');
  });
});

describe('raster header preflight', () => {
  it('reads PNG, JPEG SOF and simple/extended WebP without pixel allocation', () => {
    expect(readRasterSize(new Uint8Array(png()), 'image/png', 'p')).toEqual({ width: 1, height: 1 });
    expect(
      readRasterSize(
        new Uint8Array([255, 216, 255, 224, 0, 4, 0, 0, 255, 192, 0, 8, 8, 0, 7, 0, 11, 1]),
        'image/jpeg',
        'j',
      ),
    ).toEqual({ width: 11, height: 7 });
    const webp = (type: string, data: number[]) => {
      const b = new Uint8Array(20 + data.length + (data.length % 2)),
        view = new DataView(b.buffer);
      b.set(new TextEncoder().encode('RIFF'), 0);
      view.setUint32(4, b.length - 8, true);
      b.set(new TextEncoder().encode(`WEBP${type}`), 8);
      view.setUint32(16, data.length, true);
      b.set(data, 20);
      return b;
    };
    expect(readRasterSize(webp('VP8 ', [0, 0, 0, 157, 1, 42, 11, 0, 7, 0]), 'image/webp', 'w')).toEqual({
      width: 11,
      height: 7,
    });
    expect(readRasterSize(webp('VP8L', [47, 10, 128, 1, 0]), 'image/webp', 'w')).toEqual({
      width: 11,
      height: 7,
    });
    expect(readRasterSize(webp('VP8X', [0, 0, 0, 0, 10, 0, 0, 6, 0, 0]), 'image/webp', 'w')).toEqual({
      width: 11,
      height: 7,
    });
    expect(() => readRasterSize(webp('VP8X', [2, 0, 0, 0, 10, 0, 0, 6, 0, 0]), 'image/webp', 'w')).toThrow(
      /Animated WebP/,
    );
  });
  it('rejects missing/truncated/inconsistent headers and explicit animated PNG', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'fake'])
      expect(() => readRasterSize(new Uint8Array(20), mime, 'bad')).toThrow(AtlasError);
    const bad = new Uint8Array(png());
    new DataView(bad.buffer).setUint32(33, 0xffffffff);
    expect(() => readRasterSize(bad, 'image/png', 'bad')).toThrow(AtlasError);
    const animated = new Uint8Array(53);
    animated.set(new Uint8Array(png()).slice(0, 33));
    new DataView(animated.buffer).setUint32(33, 8);
    animated.set(new TextEncoder().encode('acTL'), 37);
    expect(() => readRasterSize(animated, 'image/png', 'bad')).toThrow(/Animated PNG/);
    expect(() => readRasterSize(new Uint8Array([255, 216, 255, 224, 255, 255]), 'image/jpeg', 'bad')).toThrow(
      AtlasError,
    );
  });
});
