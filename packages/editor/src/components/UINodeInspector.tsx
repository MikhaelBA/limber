import { uiLayout, type SceneNode, type UIComponent, type UILayoutAxis } from '@limber/core';
import { textureRegistry } from '../engine/TextureRegistry';

const input = 'w-full rounded border border-neutral-600 bg-neutral-900 px-1 py-1 text-xs';
const button = 'rounded border border-neutral-600 px-2 py-1 text-xs hover:bg-neutral-700';
export function UINodeInspector({
  node,
  components,
  onChange,
}: {
  node: SceneNode;
  components: UIComponent[];
  onChange: (node: SceneNode) => void;
}) {
  const number = (label: string, value: number, commit: (value: number) => void, step = 1) => (
    <label className="block text-xs" key={label}>
      {label}
      <input
        className={input}
        aria-label={label}
        type="number"
        step={step}
        key={`${node.id}-${label}-${value}`}
        defaultValue={value}
        onBlur={(e) => {
          if (Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber !== value)
            commit(e.target.valueAsNumber);
        }}
      />
    </label>
  );
  const patch = (values: object) => onChange({ ...node, ...values } as SceneNode);
  return (
    <div className="my-3 space-y-2 border-t border-neutral-700 pt-2" aria-label="UI node properties">
      <label className="block text-xs">
        <input
          type="checkbox"
          checked={!!node.layout}
          onChange={(e) => {
            if (e.target.checked)
              patch({
                layout: uiLayout('width' in node ? node.width : 300, 'height' in node ? node.height : 200),
              });
            else {
              const copy = { ...node };
              delete copy.layout;
              onChange(copy);
            }
          }}
        />{' '}
        Responsive layout
      </label>
      {node.layout && (
        <>
          <label className="block text-xs">
            Anchor preset
            <select
              className={input}
              aria-label="Anchor preset"
              value="custom"
              onChange={(e) => {
                const layout = structuredClone(node.layout!);
                const positions: Record<string, [number, number]> = {
                  center: [0.5, 0.5],
                  topLeft: [0, 0],
                  topRight: [1, 0],
                  bottomLeft: [0, 1],
                  bottomRight: [1, 1],
                };
                for (const [i, axis] of (['x', 'y'] as const).entries()) {
                  const value = positions[e.target.value]?.[i] ?? 0.5;
                  Object.assign(layout[axis], {
                    anchorMin: e.target.value === 'stretch' ? 0 : value,
                    anchorMax: e.target.value === 'stretch' ? 1 : value,
                    pivot: value,
                    offsetMin: 0,
                    offsetMax: 0,
                  });
                }
                patch({ layout });
              }}
            >
              <option value="custom">Custom</option>
              {['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'stretch'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <input
              type="checkbox"
              checked={!!node.layout.safeArea}
              onChange={(e) => patch({ layout: { ...node.layout, safeArea: e.target.checked } })}
            />{' '}
            Use safe area
          </label>
          {(['x', 'y'] as const).map((axis) => (
            <details key={axis}>
              <summary className="cursor-pointer text-xs">Layout {axis.toUpperCase()}</summary>
              <div className="grid grid-cols-2 gap-1">
                {(['anchorMin', 'anchorMax', 'offsetMin', 'offsetMax', 'size', 'pivot'] as const).map((key) =>
                  number(
                    `Layout ${axis} ${key}`,
                    node.layout![axis][key],
                    (value) =>
                      patch({ layout: { ...node.layout, [axis]: { ...node.layout![axis], [key]: value } } }),
                    key.startsWith('anchor') || key === 'pivot' ? 0.1 : 1,
                  ),
                )}
                {(['min', 'max'] as const).map((key) => (
                  <label className="text-xs" key={key}>
                    {key}
                    <input
                      className={input}
                      aria-label={`Layout ${axis} ${key}`}
                      type="number"
                      key={`${node.id}-${axis}-${key}-${node.layout![axis][key]}`}
                      defaultValue={node.layout![axis][key] ?? ''}
                      onBlur={(e) => {
                        const value: UILayoutAxis = { ...node.layout![axis] };
                        if (!e.target.value) delete value[key];
                        else value[key] = e.target.valueAsNumber;
                        patch({ layout: { ...node.layout, [axis]: value } });
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
          ))}
          <label className="block text-xs">
            Aspect ratio (optional)
            <input
              className={input}
              aria-label="Layout aspect"
              type="number"
              step="0.1"
              key={`${node.id}-${node.layout.aspect}`}
              defaultValue={node.layout.aspect ?? ''}
              onBlur={(e) => {
                const layout = { ...node.layout! };
                if (!e.target.value) delete layout.aspect;
                else layout.aspect = e.target.valueAsNumber;
                patch({ layout });
              }}
            />
          </label>
        </>
      )}
      {'width' in node && (
        <div className="grid grid-cols-2 gap-1">
          {number('UI width', node.width, (width) => patch({ width }))}
          {number('UI height', node.height, (height) => patch({ height }))}
        </div>
      )}
      {node.type === 'image' && (
        <button
          className={button}
          onClick={() =>
            patch({
              type: 'nineSlice',
              sourceWidth: textureRegistry.get(node.textureId)?.width ?? node.width,
              sourceHeight: textureRegistry.get(node.textureId)?.height ?? node.height,
              borders: {
                left: Math.min(8, (textureRegistry.get(node.textureId)?.width ?? node.width) / 2),
                right: Math.min(8, (textureRegistry.get(node.textureId)?.width ?? node.width) / 2),
                top: Math.min(8, (textureRegistry.get(node.textureId)?.height ?? node.height) / 2),
                bottom: Math.min(8, (textureRegistry.get(node.textureId)?.height ?? node.height) / 2),
              },
            })
          }
        >
          Convert to 9-slice
        </button>
      )}
      {node.type === 'nineSlice' && (
        <div className="grid grid-cols-2 gap-1">
          {number('Slice source width', node.sourceWidth, (sourceWidth) => patch({ sourceWidth }))}
          {number('Slice source height', node.sourceHeight, (sourceHeight) => patch({ sourceHeight }))}
          {(['left', 'right', 'top', 'bottom'] as const).map((side) =>
            number(`Slice ${side}`, node.borders[side], (value) =>
              patch({ borders: { ...node.borders, [side]: value } }),
            ),
          )}
        </div>
      )}
      {node.type === 'text' && (
        <>
          <label className="block text-xs">
            Text
            <textarea
              className={input}
              aria-label="UI text"
              dir={node.direction}
              key={`${node.id}-${node.text}`}
              defaultValue={node.text}
              onBlur={(e) => {
                if (e.target.value !== node.text) patch({ text: e.target.value });
              }}
            />
          </label>
          <label className="block text-xs">
            Font fallback list
            <input
              className={input}
              aria-label="UI font families"
              key={`${node.id}-${node.fontFamilies.join(',')}`}
              defaultValue={node.fontFamilies.join(', ')}
              onBlur={(e) =>
                patch({
                  fontFamilies: e.target.value
                    .split(',')
                    .map((name) => name.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <div className="grid grid-cols-2 gap-1">
            {number('Font size', node.fontSize, (fontSize) => patch({ fontSize }))}
            {number('Line height', node.lineHeight, (lineHeight) => patch({ lineHeight }))}
          </div>
          <label className="block text-xs">
            Direction
            <select
              className={input}
              aria-label="Text direction"
              value={node.direction}
              onChange={(e) => patch({ direction: e.target.value })}
            >
              <option>ltr</option>
              <option>rtl</option>
            </select>
          </label>
          <label className="block text-xs">
            Alignment
            <select
              className={input}
              aria-label="Text alignment"
              value={node.align}
              onChange={(e) => patch({ align: e.target.value })}
            >
              <option>start</option>
              <option>center</option>
              <option>end</option>
            </select>
          </label>
          <label className="block text-xs">
            Binding name
            <input
              className={input}
              aria-label="Text binding"
              key={`${node.id}-${node.binding}`}
              defaultValue={node.binding ?? ''}
              onBlur={(e) => {
                const copy = { ...node };
                if (e.target.value.trim()) copy.binding = e.target.value.trim();
                else delete copy.binding;
                onChange(copy);
              }}
            />
          </label>
          <p className="text-xs text-neutral-400">
            Explicit line breaks; overflowing text is clipped. Noto Sans Arabic is bundled; other families use
            system fallback.
          </p>
        </>
      )}
      {(node.type === 'text' || node.type === 'shape') && (
        <label className="block text-xs">
          Fill
          <input
            className="ml-2"
            aria-label="UI fill"
            type="color"
            key={`${node.id}-${node.color}`}
            defaultValue={`#${node.color.toString(16).padStart(6, '0')}`}
            onBlur={(e) => patch({ color: parseInt(e.target.value.slice(1), 16) })}
          />
        </label>
      )}
      {node.type === 'shape' && number('Corner radius', node.radius, (radius) => patch({ radius }))}
      {node.type === 'mask' && (
        <p className="text-xs text-neutral-400">
          Clips descendants to this rectangle. Up to eight nested masks are supported.
        </p>
      )}
      {node.type === 'instance' && (
        <>
          <p className="text-xs">Component: {components.find((c) => c.id === node.componentId)?.name}</p>
          {components
            .find((c) => c.id === node.componentId)
            ?.exposed.map((exposed) => {
              const target = components
                .find((c) => c.id === node.componentId)!
                .nodes.find((n) => n.id === exposed.nodeId)!;
              const fallback =
                exposed.property === 'text'
                  ? 'text' in target
                    ? target.text
                    : ''
                  : exposed.property === 'tint'
                    ? (target.tint ?? 0xffffff)
                    : target[exposed.property];
              const value = node.overrides[exposed.name] ?? fallback;
              return (
                <label className="block text-xs" key={exposed.name}>
                  {exposed.name}
                  <input
                    className={input}
                    aria-label={`Override ${exposed.name}`}
                    type={
                      typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text'
                    }
                    checked={typeof value === 'boolean' ? value : undefined}
                    key={`${node.id}-${exposed.name}-${value}`}
                    defaultValue={typeof value !== 'boolean' ? String(value) : undefined}
                    onChange={(e) => {
                      if (typeof value === 'boolean')
                        patch({ overrides: { ...node.overrides, [exposed.name]: e.target.checked } });
                    }}
                    onBlur={(e) => {
                      if (typeof value !== 'boolean')
                        patch({
                          overrides: {
                            ...node.overrides,
                            [exposed.name]:
                              typeof value === 'number' ? e.target.valueAsNumber : e.target.value,
                          },
                        });
                    }}
                  />
                  <button
                    className={button}
                    onClick={() => {
                      const overrides = { ...node.overrides };
                      delete overrides[exposed.name];
                      patch({ overrides });
                    }}
                  >
                    Reset {exposed.name}
                  </button>
                </label>
              );
            })}
        </>
      )}
    </div>
  );
}
