# ADR 0001 Preserve Limber while adopting BoneByBone

Status: accepted for incremental implementation, 7 October 2026.

The user authorized preserving useful existing functionality and advancing through the BoneByBone
roadmap with tested, committed and pushed milestones. A wholesale rewrite risks data and regressions.

Keep npm workspaces, the three existing packages and package identifiers during migration. They already
support strict TypeScript, numerical tests and deployment. The specification's pnpm/directory layout is
adapted to the existing repository; boundaries and behavior matter more than directory names.

Preserve the legacy skeleton evaluator and represent it as a rig node in the new scene model. Scene
and project contracts can land before generic scene rendering, but must be marked as partial milestones.
Existing global editor state/history are legacy debt to isolate before multiple project sessions are supported.
No existing phase is declared complete merely because a similarly named Limber feature exists.
