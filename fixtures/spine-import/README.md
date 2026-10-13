# Spine import acceptance fixture

Hand-authored test data (no third-party character artwork). The browser workflow
generates an asymmetric 12×8 PNG page locally to verify atlas rotation and trim.
The JSON exercises two-bone weights, Bezier rotation, translation, compatible
weighted Deform, slot order, a scalar event and a skin overriding default artwork.

The test-only official Spine 4.2 runtime is the numerical oracle. It is not shipped
or used by the import implementation. Import format references:

- https://esotericsoftware.com/spine-json-format
- https://esotericsoftware.com/spine-atlas-format

The hand-authored grid43 fixture reproduces the supported 4.3 schema and stale hull
metadata with 1073 vertices. No user artwork/project bytes are checked in. Set
BBB_SPINE_FIXTURE_DIR to the local social-masks folder to run the same browser
workflow on the actual supplied JSON/atlas/PNG; generated native project/evidence
stays in the ignored .smoke directory.

4.3 format checks also used the primary sources:

- https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/spine-ts/spine-core/src/SkeletonJson.ts
- https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/spine-ts/spine-core/src/Animation.ts
