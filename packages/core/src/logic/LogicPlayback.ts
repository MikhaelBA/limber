import { FixedStepClock } from '../animation/FixedStepClock';
import type { LogicGraph, LogicClipCatalog, LogicInput, LogicValue } from './model';
import { LogicMachine, type LogicSnapshot, type LogicChange } from './LogicMachine';
import type { LogicFiredEvent } from './eventSampling';
/** Shared clock/input/event policy. Derived adapters sample poses without renderer dependencies. */
export abstract class LogicPlayback {
  protected readonly machine: LogicMachine;
  private readonly clock = new FixedStepClock();
  private readonly listeners = new Set<(event: LogicFiredEvent) => void>();
  private epoch = 0;
  private playingValue = true;
  private advancing = false;
  readonly events: LogicFiredEvent[] = [];
  constructor(graph: LogicGraph, catalog: LogicClipCatalog) {
    this.machine = new LogicMachine(graph, catalog);
  }
  protected abstract sample(snapshot: LogicSnapshot, entered: boolean): void;
  protected abstract evaluate(advance: boolean, entered: boolean): void;
  protected abstract collect(
    fromTick: number,
    toTick: number,
    entered: boolean,
    snapshot: LogicSnapshot,
  ): LogicFiredEvent[];
  protected abstract showSetup(): void;
  protected abstract finishFrame(): void;
  /** Called only after a derived constructor has allocated its pose data. */
  protected initialize(entered = true): void {
    if (this.machine.enabled) {
      this.sample(this.machine.snapshot(), entered);
      this.evaluate(false, true);
    } else this.showSetup();
    this.finishFrame();
  }
  get playing(): boolean {
    return this.playingValue;
  }
  play(): void {
    if (this.playingValue) return;
    this.playingValue = true;
    this.clock.reset();
    this.epoch++;
  }
  pause(): void {
    if (!this.playingValue) return;
    this.playingValue = false;
    this.clock.reset();
    this.epoch++;
    this.events.length = 0;
    if (this.machine.enabled) {
      this.sample(this.machine.snapshot(), false);
      this.evaluate(false, true);
      this.finishFrame();
    }
  }
  reset(): void {
    this.machine.reset();
    this.clock.reset();
    this.epoch++;
    this.events.length = 0;
    this.initialize();
  }
  setEnabled(value: boolean): void {
    if (value === this.machine.enabled) return;
    this.machine.setEnabled(value);
    this.clock.reset();
    this.epoch++;
    this.events.length = 0;
    this.initialize(false);
  }
  /** Collect accepted fixed steps; dropped stalls and held frames produce no events. */
  update(deltaSeconds: number): number {
    if (this.advancing) throw new Error('Logic playback update cannot be reentrant.');
    this.advancing = true;
    try {
      return this.advance(deltaSeconds);
    } finally {
      this.advancing = false;
    }
  }
  private advance(deltaSeconds: number): number {
    this.events.length = 0;
    if (!this.machine.enabled) {
      this.clock.reset();
      this.showSetup();
      this.finishFrame();
      return 0;
    }
    if (!this.playingValue) {
      this.clock.reset();
      return 0;
    }
    const steps = this.clock.consume(deltaSeconds),
      epoch = this.epoch;
    let accepted = 0;
    for (let n = 0; n < steps; n++) {
      const previous = this.machine.currentStateTick;
      this.machine.step();
      const snapshot = this.machine.snapshot(),
        entered = snapshot.startedTransitionId !== null || this.machine.currentStateTick === 1;
      this.sample(snapshot, snapshot.startedTransitionId !== null);
      this.evaluate(true, snapshot.startedTransitionId !== null);
      const fired = this.collect(
        snapshot.startedTransitionId !== null ? 0 : previous,
        this.machine.currentStateTick,
        entered,
        snapshot,
      );
      accepted++;
      for (const event of fired) {
        this.events.push(event);
        for (const listener of [...this.listeners]) {
          listener(event);
          if (this.epoch !== epoch) break;
        }
        if (this.epoch !== epoch) break;
      }
      if (this.epoch !== epoch) break;
    }
    if (steps === 0) {
      this.sample(this.machine.snapshot(), false);
      this.evaluate(false, false);
    }
    this.finishFrame();
    return accepted;
  }
  get lastDiscardedSeconds(): number {
    return this.clock.lastDiscardedSeconds;
  }
  snapshot(): LogicSnapshot {
    return this.machine.snapshot();
  }
  recentChanges(): readonly LogicChange[] {
    return this.machine.recentChanges();
  }
  getParameter(name: string): LogicValue {
    return this.machine.getParameter(name);
  }
  applyInput(input: LogicInput): void {
    this.machine.applyInput(input);
  }
  setBool(name: string, value: boolean): void {
    this.machine.setBool(name, value);
  }
  setFloat(name: string, value: number): void {
    this.machine.setFloat(name, value);
  }
  setInt(name: string, value: number): void {
    this.machine.setInt(name, value);
  }
  setString(name: string, value: string): void {
    this.machine.setString(name, value);
  }
  fire(name: string): void {
    this.machine.fire(name);
  }
  resetTrigger(name: string): void {
    this.machine.resetTrigger(name);
  }
  onEvent(listener: (event: LogicFiredEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
