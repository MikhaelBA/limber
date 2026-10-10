import { SECONDARY_STEP_SECONDS } from '../animation/FixedStepClock';
import type {
  LogicClipCatalog,
  LogicGraph,
  LogicInput,
  LogicParameter,
  LogicState,
  LogicTransition,
  LogicValue,
  RecordedLogicInput,
} from './model';
import { canonicalLogicValue, validateLogicGraph, validateLogicValue } from './validate';
export const LOGIC_STEP_SECONDS = SECONDARY_STEP_SECONDS;
export interface LogicBlend {
  id: string;
  from: string;
  to: string;
  priority: number;
  elapsed: number;
  duration: number;
  progress: number;
  interruption: LogicTransition['interruption'];
}
export interface LogicSnapshot {
  tick: number;
  enabled: boolean;
  stateId: string;
  stateElapsed: number;
  clip: string | null;
  clipTime: number;
  loop: boolean;
  transition: LogicBlend | null;
  startedTransitionId: string | null;
  completedTransitionId: string | null;
  parameters: Readonly<Record<string, LogicValue>>;
}
export interface LogicChange {
  tick: number;
  kind: 'parameter' | 'triggerConsumed' | 'transition' | 'completed' | 'enabled';
  name: string;
  value: LogicValue;
}
interface ActiveBlend {
  entry: LogicTransition;
  from: string;
  ticks: number;
}
/** Portable fixed-step state/parameter kernel. Pose blending belongs to its adapter. */
export class LogicMachine {
  private readonly graph: LogicGraph;
  private readonly parameters: Map<string, LogicParameter>;
  private readonly byName: Map<string, LogicParameter>;
  private readonly states: Map<string, LogicState>;
  private readonly durations: Map<string, number>;
  private readonly ordered: LogicTransition[];
  private readonly values = new Map<string, LogicValue>();
  private readonly pending: LogicInput[] = [];
  private readonly changes: LogicChange[] = [];
  private state: LogicState;
  private ticks = 0;
  private stateTicks = 0;
  private blend: ActiveBlend | null = null;
  private enabledValue: boolean;
  private started: string | null = null;
  private completed: string | null = null;
  constructor(graph: LogicGraph, catalog: LogicClipCatalog) {
    validateLogicGraph(graph, catalog);
    this.graph = structuredClone(graph);
    this.parameters = new Map(this.graph.parameters.map((p) => [p.id, p]));
    this.byName = new Map(this.graph.parameters.map((p) => [p.name, p]));
    this.states = new Map(this.graph.states.map((s) => [s.id, s]));
    this.durations = new Map(
      this.graph.states.map((s) => [s.id, s.clip === null ? 0 : catalog.get(s.clip)!.duration]),
    );
    this.ordered = [...this.graph.transitions].sort((a, b) => a.priority - b.priority);
    this.state = this.states.get(this.graph.entryStateId)!;
    this.enabledValue = this.graph.enabled;
    this.reset();
  }
  reset(): void {
    this.ticks = 0;
    this.stateTicks = 0;
    this.blend = null;
    this.started = null;
    this.completed = null;
    this.pending.length = 0;
    this.changes.length = 0;
    this.enabledValue = this.graph.enabled;
    this.state = this.states.get(this.graph.entryStateId)!;
    this.values.clear();
    for (const p of this.parameters.values()) this.values.set(p.id, canonicalLogicValue(p.type, p.initial));
  }
  get enabled(): boolean {
    return this.enabledValue;
  }
  get currentStateTick(): number {
    return this.stateTicks;
  }
  setEnabled(value: boolean): void {
    if (typeof value !== 'boolean') throw new Error('Logic enabled must be boolean.');
    if (value === this.enabledValue) return;
    this.enabledValue = value;
    this.started = null;
    this.completed = null;
    this.log('enabled', this.graph.name, value);
  }
  getParameter(name: string): LogicValue {
    const p = this.byName.get(name);
    if (!p) throw new Error(`Unknown Logic parameter "${name}".`);
    return this.values.get(p.id)!;
  }
  setBool(name: string, value: boolean): void {
    this.applyInput({ name, type: 'bool', value });
  }
  setFloat(name: string, value: number): void {
    this.applyInput({ name, type: 'float', value });
  }
  setInt(name: string, value: number): void {
    this.applyInput({ name, type: 'int', value });
  }
  setString(name: string, value: string): void {
    this.applyInput({ name, type: 'string', value });
  }
  fire(name: string): void {
    this.applyInput({ name, type: 'trigger', value: true });
  }
  resetTrigger(name: string): void {
    this.applyInput({ name, type: 'trigger', value: false });
  }
  /** Validate all input before enqueueing. Values publish at the next accepted step. */
  applyInput(input: LogicInput): void {
    if (!input || typeof input !== 'object') throw new Error('Logic input must be an object.');
    const p = this.byName.get(input.name);
    if (!p) throw new Error(`Unknown Logic parameter "${input.name}".`);
    if (input.type !== p.type)
      throw new Error(`Logic parameter "${p.name}" requires ${p.type}, not ${input.type}.`);
    validateLogicValue(p.type, input.value, `Parameter ${p.name}`);
    if (this.pending.length >= 1024) throw new Error('At most 1024 Logic inputs may wait for a step.');
    this.pending.push({ ...input, value: canonicalLogicValue(p.type, input.value) } as LogicInput);
  }
  /** Integer ticks are the only time source; one transition at most per step. */
  step(): void {
    this.started = null;
    this.completed = null;
    if (!this.enabledValue) return;
    for (const input of this.pending) {
      const p = this.byName.get(input.name)!;
      if (this.values.get(p.id) !== input.value) {
        this.values.set(p.id, input.value);
        this.log('parameter', p.name, input.value);
      }
    }
    this.pending.length = 0;
    if (this.blend && this.blend.ticks * LOGIC_STEP_SECONDS + 1e-12 >= this.blend.entry.blendDuration) {
      this.completed = this.blend.entry.id;
      this.log('completed', this.completed, this.state.id);
      this.blend = null;
    }
    for (const t of this.ordered) {
      if (t.to === this.state.id || (t.from !== null && t.from !== this.state.id)) continue;
      if (this.blend && (this.blend.entry.interruption === 'none' || t.priority >= this.blend.entry.priority))
        continue;
      if (t.exitTime !== undefined) {
        const exit = this.durations.get(this.state.id)! * t.exitTime;
        if ((exit > 0 && this.stateTicks === 0) || this.stateTicks * LOGIC_STEP_SECONDS + 1e-12 < exit)
          continue;
      }
      if (
        !t.conditions.every((c) => {
          const p = this.parameters.get(c.parameterId)!,
            a = this.values.get(p.id)!;
          if (c.operator === 'fired') return a === true;
          const b = canonicalLogicValue(p.type, c.value);
          switch (c.operator) {
            case 'eq':
              return a === b;
            case 'neq':
              return a !== b;
            case 'gt':
              return a > b;
            case 'gte':
              return a >= b;
            case 'lt':
              return a < b;
            case 'lte':
              return a <= b;
          }
        })
      )
        continue;
      for (const c of t.conditions)
        if (c.operator === 'fired') {
          const p = this.parameters.get(c.parameterId)!;
          if (this.values.get(p.id) === true) {
            this.values.set(p.id, false);
            this.log('triggerConsumed', p.name, false);
          }
        }
      const from = this.state.id;
      this.state = this.states.get(t.to)!;
      this.stateTicks = 0;
      this.started = t.id;
      this.blend = t.blendDuration > 0 ? { entry: t, from, ticks: 0 } : null;
      this.log('transition', t.id, this.state.id);
      break;
    }
    this.stateTicks++;
    if (this.blend) this.blend.ticks++;
    this.ticks++;
  }
  snapshot(): LogicSnapshot {
    const elapsed = this.stateTicks * LOGIC_STEP_SECONDS,
      duration = this.durations.get(this.state.id)!;
    let clipTime = this.state.loop && duration > 0 ? elapsed % duration : Math.min(elapsed, duration);
    // Stable seam across binary representation of integer-step duration.
    const cycles = duration > 0 ? elapsed / duration : 0;
    if (
      this.state.loop &&
      duration > 0 &&
      Math.abs(cycles - Math.round(cycles)) <= 8 * Number.EPSILON * Math.max(1, Math.abs(cycles))
    )
      clipTime = 0;
    const b = this.blend,
      transition = b
        ? {
            id: b.entry.id,
            from: b.from,
            to: this.state.id,
            priority: b.entry.priority,
            elapsed: b.ticks * LOGIC_STEP_SECONDS,
            duration: b.entry.blendDuration,
            progress: Math.min(1, (b.ticks * LOGIC_STEP_SECONDS) / b.entry.blendDuration),
            interruption: b.entry.interruption,
          }
        : null;
    return {
      tick: this.ticks,
      enabled: this.enabledValue,
      stateId: this.state.id,
      stateElapsed: elapsed,
      clip: this.state.clip,
      clipTime,
      loop: this.state.loop,
      transition,
      startedTransitionId: this.started,
      completedTransitionId: this.completed,
      parameters: Object.fromEntries([...this.byName].map(([name, p]) => [name, this.values.get(p.id)!])),
    };
  }
  recentChanges(): readonly LogicChange[] {
    return this.changes.map((c) => ({ ...c }));
  }
  private log(kind: LogicChange['kind'], name: string, value: LogicValue): void {
    this.changes.push({ tick: this.ticks, kind, name, value });
    if (this.changes.length > 64) this.changes.shift();
  }
}

/** Validate replay tick ordering. Parameter values validate through the machine's typed API. */
export function validateRecordedLogicInputs(inputs: readonly RecordedLogicInput[]): void {
  if (!Array.isArray(inputs)) throw new Error('Recorded Logic inputs must be an array.');
  let previous = -1;
  for (const entry of inputs) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isSafeInteger(entry.tick) ||
      entry.tick < 0 ||
      entry.tick < previous
    )
      throw new Error('Recorded Logic inputs require ordered nonnegative integer ticks.');
    previous = entry.tick;
  }
}
