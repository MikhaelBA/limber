/** Browser-only test hook: real Worker computation, deterministic final-message delivery. */
export function installHeldWorkers() {
  const NativeWorker = window.Worker;
  window.__workerJobs = [];
  window.Worker = class {
    onmessage = null;
    onerror = null;
    constructor(url, options) {
      this.native = new NativeWorker(url, options);
      this.stats = { frames: 0, gaps: [], terminated: false, result: null };
      window.__workerJobs.push(this.stats);
      let last = performance.now();
      const frame = (now) => {
        if (this.stats.terminated || this.stats.result) return;
        this.stats.frames++;
        this.stats.gaps.push(now - last);
        last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      this.native.onmessage = (event) => {
        if (event.data.kind === 'progress' && event.data.fraction === 0) {
          this.stats.frames = 0;
          this.stats.gaps = [];
          last = performance.now();
        }
        if (event.data.kind === 'result') {
          this.stats.result = event.data;
          this.pending = event;
        } else this.onmessage?.(event);
      };
      this.native.onerror = (event) => this.onerror?.(event);
      window.__releaseWeights = async () => {
        const start = performance.now();
        if (this.pending && !this.stats.terminated) this.onmessage?.(this.pending);
        // Drain the job wrapper and authoring promise continuations, including publication.
        for (let i = 0; i < 4; i++) await Promise.resolve();
        return performance.now() - start;
      };
    }
    postMessage(message) {
      this.native.postMessage(message);
    }
    terminate() {
      this.stats.terminated = true;
      this.native.terminate();
    }
  };
}
