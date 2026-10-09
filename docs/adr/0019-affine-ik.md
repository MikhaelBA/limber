# ADR 0019: Affine IK, poles and soft reach

Status: accepted, Phase 7B. The implementation is derived from our FK convention;
no third-party constraint source or runtime format is used.

For a two-bone chain, in the chain parent's coordinates, the endpoint is
`R(r1) A1 (v + R(r2) w)`, where `A = ShearX ShearY Scale`, `v` is the lower
bone's actual translation, and `w = A2 (length2, 0)`. Solve the attainable radius
of the offset ellipse `A1(v + R(r2)w)`, then rotate that vector toward the target.
This supports arbitrary invertible parent transforms, signed/nonuniform chain
scales and shear without changing authored geometry. Conformal upper transforms
use the equivalent circle solution; other transforms solve a degree-two trig
polynomial using bounded half-angle quartics. Derivative roots partition monotonic
intervals, including tangencies; no unbounded iterative IK or frame allocation.

Unreachable targets project radially to the attainable radius interval in the
chain parent's coordinates. This is a specified deterministic projection, not a
claim of minimum world-space Euclidean error under nonuniform parent scaling.
World-space cross product of root-to-target and root-to-joint defines bend side,
including mirrored parents. An independent pole bone overrides the side unless
it lies on the target line, when serialized bendDirection is used. With multiple
same-side solutions choose the smallest sum of squared shortest-arc changes from
the sampled rotations; fixed root enumeration breaks ties deterministically.

Softness is a nonnegative distance in chain-parent units, effective for two-bone
IK with nonzero reaches. One-bone pole/nonzero-softness authoring rejects explicitly.
Clamp its effective value to the attainable radius span.
For maximum reach M and effective softness s, distances above M-s become
`M - s * exp(-(distance - (M-s))/s)`. This has matching value/slope at the boundary
and approaches full extension smoothly. Zero softness reaches exactly; it never
stretches lengths or scales. Stretch is not implemented or advertised.

Mix blends both solved LOCAL rotations using the shortest arc from the sampled
pose. Mix zero leaves all pose fields/matrices exactly untouched. Recompute FK
after every active solve so later constraints see current targets and poles.

Singular/near-singular parents (`abs(det) <= maxAbsBasis^2 * 1e-12`) hold the
sampled pose. A zero lower reach aims the joint and holds lower rotation. A zero
joint offset still permits a lower endpoint solve; fully collapsed reach holds.
At a target coincident with the chain root, retain root rotation if zero radius
is attainable. Zero-length one-bone chains and coincident one-bone targets hold.
Near-zero guards use 1e-12 parent-space units, with deterministic finite output.

Pole references participate in subtree dependency/order/cycle validation. Target
and pole read only positions: a writer does not move its own root origin, so only
strict descendants create position dependencies. Chain parents read full affine
transforms, including the writer root. Own-subtree targets/poles remain rejected.

Semantic pins now accept invertible affine limbs/parents, still requiring the
endpoint pivot at the lower bone's +X tip and a nonzero aligned joint offset.
Collapsed pins fail atomically before publication. Advanced IK can still author
collapsed geometry with the documented hold/reduction behavior. Pole/softness
authoring is Setup-only, atomic and serialized through existing schema-6 fields.
