# Face weight-painting example

Open `Face-Weights.bbbproj` with the editor's **Open…** button. The generated face is
embedded, so no separate texture import is required. Choose **Animate**, select
**Face — weights demo**, then **Play** (Space). The four-second loop lifts the cheeks,
stretches the jaw and raises the brows. The head bone stays still: movement comes from
normalized mesh weights and seven bone-property tracks, without Deform keys or baked frames.

## Paint weights

1. Return to **Setup** and select the slot **Face mesh — paint here** in the hierarchy.
2. Click **Weights** (W). Choose **Jaw**, **Cheek L/R** or **Brow L/R** in **Paint bone**.
   Clicking a hierarchy bone while Weights is active also changes this target and retains
   the selected mesh slot.
3. Drag over the visible vertices. Radius `R` controls brush size; strength `S` controls
   each dab. Blue-to-red vertex colors show the selected bone's influence. Each stroke
   is one undo step. `add` increases influence; `set` raises it toward the brush amount;
   `smooth` relaxes it toward adjacent vertices.
4. Play the clip again to see the changed movement. Use **Undo** to restore the original.

This example already binds all six bones to the setup pose. For your own image, create
a mesh first, choose its binding bones and use **Bind setup pose** before painting.
Weight painting is a Setup operation; Animate mode displays the weights and asks you
to return to Setup before changing them.

The example uses one continuous 625-vertex face mesh, 1,152 triangles, up to three
influences per vertex and one PNG generated with Image Generation. It demonstrates
soft image deformation; opening the mouth or blinking would need additional authored
artwork and animation.

Rebuild and verify from the repository root:

```sh
node examples/face-weights/build-project.mjs
node examples/face-weights/verify-project.mjs
```

The prompt is retained in `generation-prompts.md`. Browser acceptance exercises real
painting, history, save/reopen and playback through the editor UI.

`validation.json` records numerical native/editor verification. `browser-validation.json`
records actual UI acceptance. `weights-preview.png` shows the tested Jaw brush stroke;
`animation-preview.png` shows subsequent playback. The delivered project retains the
original example weights so you can experiment independently.
