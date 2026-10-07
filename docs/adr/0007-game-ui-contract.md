# ADR 0007: Responsive game UI and component overrides

Status: accepted after Phase 3 CI run 37675345618 passed.

## Layout

Schema 3 adds optional layout boxes and safe-area insets. Older schemas migrate in memory by updating the schema identifier only; no layout means the original absolute transform behavior. Artboard and node boxes use centered coordinates, positive Y downward. Layout is evaluated before animation transforms; the authored transform remains an additive offset, rotation, shear and scale over the resolved box.

Each axis has normalized start/end anchors, start/end pixel offsets, a fixed size and a normalized alignment pivot. Equal anchors give fixed size; different anchors stretch between the two edges. Min/max bounds clamp the result, keeping the pivot at the same relative location. Optional aspect ratio fits inside the clamped box; incompatible min/max/aspect combinations are rejected. Root nodes may choose the artboard safe rectangle. Children use their parent's resolved, unscaled local box. Groups without boxes pass through the containing box. No CSS/Flexbox inference or content-dependent layout is introduced.

Nine-slice borders are source-image pixels and stay independent of destination size. Destinations smaller than the combined borders proportionally compress opposing borders without negative center geometry. Store exact borders, source dimensions and texture ID; do not bake them into scaled images. Rectangle masks apply to descendants, with a supported maximum of eight nested masks including component expansion.

## Text

Use the browser Canvas 2D text shaping path for Web UI Alpha, drawing whole explicit lines with a specified base direction. Do not reverse strings, split Arabic into isolated glyphs or pretend Latin metrics work for all scripts. Canvas delegates shaping and bidirectional processing to the browser ([HTML text preparation algorithm](https://html.spec.whatwg.org/multipage/canvas.html#text-preparation-algorithm)). Store Unicode text, font-family fallback list, font size, line height, direction, alignment, color and optional binding name. Keep measurement/rasterization behind a text adapter; core never imports browser APIs.

V1 supports explicit newlines, clipping and overflow diagnostics; automatic paragraph wrapping and rich text are deferred. Preview values include short, expected, long and extreme numeric strings. System font fallback is permitted for preview, but is not a cross-platform glyph-parity guarantee. Bundle a licensed test font for deterministic RTL evidence before closing UI Alpha. No font upload or redistribution is implied by a system-family choice; future bundled font import must record license metadata. Native runtime text adapters require their own shaping/parity evidence.

## Components

Definitions own stable IDs, a revision, nominal dimensions, a node tree and explicitly exposed properties. Instances reference a definition and store overrides by exposed property name; they never copy its child tree into authored scene data. Expansion is pure and produces deterministic instance-qualified IDs. Nested instances are supported; dependency cycles, excessive nesting and expanded-node budgets fail explicitly before rendering.

V1 exposed values are text (string), tint/opacity (number) and visibility (boolean), with typed targets. Unknown overrides, incompatible types, removed targets and removal of definitions still in use are rejected atomically. Structure/default edits propagate to all instances; valid overrides win. Revisions increase on definition edits. Renaming/removing an exposed property with existing overrides requires an explicit migration transaction; v1 rejects the edit instead of silently dropping overrides. Unexposed structure cannot be edited through an instance. Component-local motion/state logic is a later extension of this contract, not a copied animation library.

## Gate

Preserve historical fixtures and legacy character workflows. Add numerical layout/expansion/validation tests, reversible commands, and a reward popup fixture used at four aspect ratios. Browser evidence must cover nine-slice corners, nested clipping, RTL shaping with the selected font, localization overflow and override propagation. Save/reopen must preserve all UI metadata; shipping `.bbb` compilation remains Phase 9.
