import { create } from 'zustand';

interface WeightUI {
  scope: string;
  pathId: string | null;
  vertices: number[];
  bones: string[];
  feather: number;
  pies: boolean;
  overlay: boolean;
  selectedOnly: boolean;
  binding: boolean;
  preview: Record<string, number[]> | null;
  clipboard: { rows: { boneId: string; weight: number }[][] } | null;
  setScope: (scope: string) => void;
  setVertices: (vertices: number[]) => void;
  setBones: (bones: string[]) => void;
  patch: (
    patch: Partial<
      Pick<
        WeightUI,
        'pathId' | 'feather' | 'pies' | 'overlay' | 'selectedOnly' | 'binding' | 'clipboard' | 'preview'
      >
    >,
  ) => void;
}
/** Retained across transform tool switches; replaced on document/rig/attachment change. */
export const useWeightEditingStore = create<WeightUI>((set) => ({
  scope: '',
  pathId: null,
  vertices: [],
  bones: [],
  feather: 0.5,
  pies: true,
  overlay: false,
  selectedOnly: false,
  binding: false,
  clipboard: null,
  preview: null,
  setScope: (scope) =>
    set((s) => (scope === s.scope ? {} : { scope, vertices: [], bones: [], binding: false, preview: null })),
  setVertices: (vertices) => set({ vertices: [...new Set(vertices)].sort((a, b) => a - b) }),
  setBones: (bones) => set({ bones: [...new Set(bones)] }),
  patch: (patch) => set(patch),
}));

export const WEIGHT_COLORS = [0x54c4ff, 0xff785f, 0x92d65d, 0xdd8bff, 0xffcf59, 0x59dfc2, 0xf587bc, 0xa0a5ff];
export const weightColor = (index: number): number => {
  if (index < WEIGHT_COLORS.length) return WEIGHT_COLORS[index]!;
  const hue = ((index * 137.508) % 360) / 60,
    c = 0.65,
    x = c * (1 - Math.abs((hue % 2) - 1)),
    m = 0.28;
  const rgb =
    hue < 1
      ? [c, x, 0]
      : hue < 2
        ? [x, c, 0]
        : hue < 3
          ? [0, c, x]
          : hue < 4
            ? [0, x, c]
            : hue < 5
              ? [x, 0, c]
              : [c, 0, x];
  return rgb.reduce((color, value) => color * 256 + Math.round((value + m) * 255), 0);
};
