import type { Artboard, SceneNode, TextNode } from '../project/model';
import type { UIComponent, UIOverrideValue } from '../project/ui';
import type { LogicGraph, LogicBinding, LogicValue } from './model';
import {
  LogicValidationError,
  validateLogicBindingValue,
  validateLogicValue,
  validateLogicGraph,
} from './validate';
interface BakedExposure extends LogicBinding {
  parameterName: string;
}
interface BakedText {
  nodeId: string;
  parameterName: string;
}
function fail(code: string, message: string, id: string): never {
  throw new LogicValidationError(code, id, message);
}
/** Baked one-way view projection. It never edits source, definitions or stored overrides. */
export class LogicSceneBindings {
  private readonly exposures: BakedExposure[];
  private readonly texts: BakedText[];
  constructor(graph: LogicGraph, board: Artboard, components: readonly UIComponent[] = []) {
    validateLogicGraph(
      graph,
      new Map((board.clips ?? []).map((clip) => [clip.id, { duration: clip.duration }])),
    );
    const parameters = new Map(graph.parameters.map((p) => [p.id, p])),
      byName = new Map(graph.parameters.map((p) => [p.name, p])),
      nodes = new Map(board.nodes.map((n) => [n.id, n])),
      definitions = new Map(components.map((c) => [c.id, c]));
    this.exposures = (graph.bindings ?? []).map((binding) => {
      const instance = nodes.get(binding.instanceId);
      if (!instance || instance.type !== 'instance')
        fail(
          'MISSING_BINDING_INSTANCE',
          'Binding needs a component instance in its own artboard.',
          binding.id,
        );
      const definition = definitions.get(instance.componentId);
      if (!definition)
        fail('MISSING_BINDING_COMPONENT', 'Binding component definition is missing.', binding.id);
      const exposure = definition.exposed.find((e) => e.name === binding.exposureName);
      if (!exposure)
        fail(
          'MISSING_BINDING_EXPOSURE',
          `Expose ${binding.exposureName} on this component before binding it.`,
          binding.id,
        );
      if (exposure.property !== binding.property)
        fail(
          'BINDING_PROPERTY_MISMATCH',
          'Binding property no longer matches its exposure; explicitly migrate the binding.',
          binding.id,
        );
      const target = definition.nodes.find((n) => n.id === exposure.nodeId);
      if (!target) fail('MISSING_BINDING_TARGET', 'Exposed binding target is missing.', binding.id);
      if (exposure.property === 'text' && target.type !== 'text')
        fail('INVALID_BINDING_TARGET', 'Text exposure must target a text node.', binding.id);
      const parameter = parameters.get(binding.parameterId);
      if (!parameter) fail('MISSING_PARAMETER', 'Binding parameter does not exist.', binding.id);
      return { ...binding, parameterName: parameter.name };
    });
    this.texts = board.nodes.flatMap((node) => {
      if (node.type !== 'text' || node.binding === undefined) return [];
      const p = byName.get(node.binding);
      if (!p || p.type !== 'string')
        fail(
          'INVALID_TEXT_BINDING',
          `Text ${node.name} needs its artboard graph's string parameter ${node.binding}.`,
          node.id,
        );
      return [{ nodeId: node.id, parameterName: p.name }];
    });
  }
  apply(view: Artboard, values: Readonly<Record<string, LogicValue>>): Artboard {
    // Validate every write first; callers cannot partially publish a forged parameter view.
    for (const exposure of this.exposures)
      validateLogicBindingValue(exposure.property, values[exposure.parameterName], exposure.id);
    for (const text of this.texts)
      validateLogicValue('string', values[text.parameterName], `Text ${text.nodeId}`);
    const patches = new Map<string, SceneNode>(),
      byId = new Map(view.nodes.map((n) => [n.id, n]));
    for (const exposure of this.exposures) {
      const node = patches.get(exposure.instanceId) ?? byId.get(exposure.instanceId);
      if (!node || node.type !== 'instance')
        fail('MISSING_BINDING_INSTANCE', 'Rebuild bindings after scene publication.', exposure.id);
      patches.set(node.id, {
        ...node,
        overrides: {
          ...node.overrides,
          [exposure.exposureName]: values[exposure.parameterName] as UIOverrideValue,
        },
      });
    }
    for (const text of this.texts) {
      const node = patches.get(text.nodeId) ?? byId.get(text.nodeId);
      if (!node || node.type !== 'text')
        fail('MISSING_BINDING_TARGET', 'Rebuild text bindings after scene publication.', text.nodeId);
      patches.set(node.id, { ...node, text: values[text.parameterName] as TextNode['text'] });
    }
    return patches.size ? { ...view, nodes: view.nodes.map((n) => patches.get(n.id) ?? n) } : view;
  }
}
