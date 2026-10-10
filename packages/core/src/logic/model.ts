/** Renderer-free authoring model. Source ownership/UI integration follows in Phase 8B. */
export type LogicValue = boolean | number | string;
interface ParameterBase {
  id: string;
  name: string;
}
export type LogicParameter = ParameterBase &
  (
    | { type: 'bool'; initial: boolean }
    | { type: 'float' | 'int'; initial: number }
    | { type: 'string'; initial: string }
    | { type: 'trigger'; initial: false }
  );
export type LogicCondition =
  | { parameterId: string; operator: 'fired' }
  | { parameterId: string; operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: LogicValue };
export interface LogicState {
  id: string;
  name: string;
  /** Scene clip ID or rig animation name; null samples setup. */
  clip: string | null;
  loop: boolean;
  position?: { x: number; y: number };
}
export interface LogicTransition {
  id: string;
  /** null = Any State. */
  from: string | null;
  to: string;
  priority: number;
  conditions: LogicCondition[];
  exitTime?: number;
  blendDuration: number;
  interruption: 'none' | 'higherPriority';
}
export interface LogicGraph {
  id: string;
  name: string;
  enabled: boolean;
  entryStateId: string;
  parameters: LogicParameter[];
  states: LogicState[];
  transitions: LogicTransition[];
  bindings?: LogicBinding[];
}
/** Explicit component exposure in the graph owner's artboard. */
export interface LogicBinding {
  id: string;
  parameterId: string;
  instanceId: string;
  exposureName: string;
  property: 'text' | 'visible' | 'opacity' | 'tint';
}
export type LogicClipCatalog = ReadonlyMap<string, { readonly duration: number }>;
export type LogicInput =
  | { name: string; type: 'bool'; value: boolean }
  | { name: string; type: 'float' | 'int'; value: number }
  | { name: string; type: 'string'; value: string }
  | { name: string; type: 'trigger'; value: boolean };
export interface RecordedLogicInput {
  tick: number;
  input: LogicInput;
}
