# Spine import acceptance fixture

Hand-authored test data (no third-party character artwork). The browser workflow
generates an asymmetric 12×8 PNG page locally to verify atlas rotation and trim.
The JSON exercises two-bone weights, Bezier rotation, translation, compatible
weighted Deform, slot order, a scalar event and a skin overriding default artwork.

The test-only official Spine 4.2 runtime is the numerical oracle. It is not shipped
or used by the import implementation. Import format references:

- https://esotericsoftware.com/spine-json-format
- https://esotericsoftware.com/spine-atlas-format
