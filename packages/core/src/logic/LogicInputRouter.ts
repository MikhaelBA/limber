import type { LogicGraph, LogicClipCatalog, LogicInput, LogicRouteEvent, LogicValue } from './model';
import { LOGIC_ROUTE_EVENTS } from './model';
import { LogicValidationError, validateLogicGraph } from './validate';
export interface LogicInputSink {
  applyInputs(inputs: readonly LogicInput[]): void;
  snapshot(): { tick: number };
}
export interface LogicDispatch {
  tick: number;
  sequence: number;
  event: LogicRouteEvent;
  targetId: string | null;
  routeIds: string[];
  inputs: LogicInput[];
}
export function validateLogicRouteTargets(graph: LogicGraph, targets: ReadonlySet<string> = new Set()): void {
  for (const route of graph.routes ?? [])
    if (route.targetId !== null && !targets.has(route.targetId))
      throw new LogicValidationError(
        'MISSING_ROUTE_TARGET',
        route.id,
        'Route needs a node in its own artboard, or the viewport target.',
      );
}
/** Baked authored-order routing, independent of DOM and renderer events. */
export class LogicInputRouter {
  private readonly routes: {
    id: string;
    targetId: string | null;
    event: LogicRouteEvent;
    input: LogicInput;
  }[];
  private readonly trace: LogicDispatch[] = [];
  private sequence = 0;
  private tracedInputs = 0;
  constructor(
    graph: LogicGraph,
    catalog: LogicClipCatalog,
    private readonly sink: LogicInputSink,
    targets?: ReadonlySet<string>,
  ) {
    validateLogicGraph(graph, catalog);
    validateLogicRouteTargets(graph, targets);
    const parameters = new Map(graph.parameters.map((p) => [p.id, p]));
    this.routes = (graph.routes ?? []).map((route) => {
      const p = parameters.get(route.parameterId)!;
      return {
        id: route.id,
        targetId: route.targetId,
        event: route.event,
        input: {
          name: p.name,
          type: p.type,
          value: p.type === 'trigger' ? true : (route.value as LogicValue),
        } as LogicInput,
      };
    });
  }
  dispatch(event: LogicRouteEvent, targetId: string | null = null): number {
    if (!(LOGIC_ROUTE_EVENTS as readonly unknown[]).includes(event))
      throw new Error('Unknown Logic interaction event.');
    if (targetId !== null && (typeof targetId !== 'string' || !targetId.trim()))
      throw new Error('Invalid Logic interaction target.');
    const routes = this.routes.filter((route) => route.event === event && route.targetId === targetId);
    if (!routes.length) return 0;
    const inputs = routes.map((route) => ({ ...route.input }));
    // The sink preflights the entire batch before changing the queue.
    this.sink.applyInputs(inputs);
    this.trace.push({
      tick: this.sink.snapshot().tick,
      sequence: this.sequence++,
      event,
      targetId,
      routeIds: routes.map((route) => route.id),
      inputs: structuredClone(inputs),
    });
    this.tracedInputs += inputs.length;
    while (this.trace.length > 256 || this.tracedInputs > 1024)
      this.tracedInputs -= this.trace.shift()!.inputs.length;
    return routes.length;
  }
  recentDispatches(): readonly LogicDispatch[] {
    return structuredClone(this.trace);
  }
  resetTrace(): void {
    this.trace.length = 0;
    this.sequence = 0;
    this.tracedInputs = 0;
  }
}
