export type BoneIconKind = 'bone' | 'root' | 'point' | 'target';

/** Small vector guide icons share the bone's authoring color. */
export function BoneIcon({ kind, color }: { kind: BoneIconKind; color: number }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      role="img"
      aria-label={`${kind} bone icon`}
      className="shrink-0"
      style={{ color: '#' + color.toString(16).padStart(6, '0') }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {kind === 'bone' && (
        <>
          <path d="M3 12L5 6L13 2L9 10Z" fill="currentColor" fillOpacity=".18" />
          <circle cx="3" cy="12" r="2" />
        </>
      )}
      {kind === 'root' && (
        <>
          <path d="M8 1V5M8 11V15M1 8H5M11 8H15" />
          <circle cx="8" cy="8" r="2" />
        </>
      )}
      {kind === 'point' && (
        <>
          <path d="M8 2L14 8L8 14L2 8Z" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
        </>
      )}
      {kind === 'target' && (
        <>
          <circle cx="8" cy="8" r="4" />
          <path d="M8 1V5M8 11V15M1 8H5M11 8H15" />
        </>
      )}
    </svg>
  );
}
