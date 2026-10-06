# ADR 0002 Renderer and source runtime formats

Status: accepted, 7 October 2026.

Retain Pixi/WebGL as the production renderer and extract a documented adapter incrementally. WebGPU
is optional later. Core must not import renderer types; evaluated scene data is the adapter boundary.

Introduce a versioned BoneByBone project envelope and preserve Limber v1/v2 import. Use a separate
runtime compiler/schema at Runtime Alpha. Preserve Spine export as a compatibility option, not as the
native shipping contract. Never overwrite the source file on import; failed migrations leave the active
project unchanged. Immutable legacy fixtures prove compatibility throughout the transition.

Project/artboard/scene node references use IDs, not names or paths. Existing rig IDs are retained.
Legacy animation/skin names remain valid within their rig until an explicit ID migration is implemented.
