# Ship workflow

Open the **Ship** workspace after authoring a scene or character. Select the runtime
entry artboard and **Prepare native export**. Preparation captures the source and loaded
image bytes, packs the atlas in a worker and embeds referenced fonts. Progress and
Cancel remain available during processing. Source edits and atlas settings require a
new preparation; playback never writes preview values into the source project.

After packaged resource decoding succeeds, use **Download .bbb** for the compact native
asset or **Download debug JSON** to inspect the independent runtime representation.
Use **Open native .bbb** to play an existing asset while retaining the source document.
These runtime files are distinct from editable `.bbbproj` documents saved through Save.

Use the native artboard and clip selectors, Play/Pause, Step while paused, and Stop to
inspect actual packaged playback. Reset restores initial Logic parameters and clocks.
Select the input owner under **Packaged Logic inputs** to test scene or character typed
parameters, triggers and routes. Values queue for the next accepted tick; Pause and Step
to inspect them. Physical pointer/focus and Enter/Space confirm go to the selected owner.
Viewport presets resize responsive UI without resetting clocks. Source focus is being
completed in Phase 9.
The Web SDK is available; Unity/Cocos integration is still pending its engine gates.

Expand **Atlas settings** for page size, padding, scale, trim, rotation and power-of-two
pages. Packing uses straight alpha and preserves full UV domains for meshes and 9-slice.
Expand **Atlas inspection**, select a page and click or press Enter/Space on a region to
inspect its frame, crop and rotation.

Platform policies warn about resource/work costs. Mobile Low/High, Desktop and Web are
starting thresholds; Custom accepts team limits and saves them in browser workspace
storage. Invalid thresholds cannot replace the active policy. Warnings permit export;
resource/format errors require correction. Findings show a code, severity, object and
remedy. The inventory includes all variants; the posed workload counts currently selected
geometry, including hidden independent rigs that still incur CPU work.

Texture memory is an approximate base-level RGBA8 allocation, excluding mipmaps, driver
overhead and retained CPU copies. Encoded image/font bytes are reported separately.
Measured update includes Web adapter sync; render submission measures CPU time rather
than GPU completion. Draw counts cover supported core WebGL2 methods. Unknown values
remain unmeasured. Confirm performance on target hardware.

Referenced fonts must carry actual bytes and redistribution metadata. The bundled Noto
font includes its OFL notice. Import other fonts through authoring controls. SVG text
requires supported explicit font declarations matching internal names; coded unsupported
style/font findings need supported inline attributes or conversion to paths.
