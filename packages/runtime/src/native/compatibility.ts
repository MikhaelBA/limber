import { nativeAssetState, type NativeRuntimeAsset } from './NativeRuntimeAsset';
import { RUNTIME_FEATURES, RUNTIME_VERSION, type RuntimeFeature } from './model';

/** Only implemented/accepted hosts are marked available. Engine gates extend this table. */
export function inspectRuntimeCompatibility(asset: NativeRuntimeAsset): {
  version: number;
  requiredFeatures: RuntimeFeature[];
  hosts: {
    id: string;
    status: 'available' | 'pending';
    version: number | null;
    features: RuntimeFeature[];
    note: string;
  }[];
} {
  const program = nativeAssetState(asset).program;
  return {
    version: program.version,
    requiredFeatures: [...program.features],
    hosts: [
      {
        id: 'web',
        status: 'available',
        version: RUNTIME_VERSION,
        features: [...RUNTIME_FEATURES],
        note: 'Native Web adapter; verify decoded resources and target-device performance.',
      },
      {
        id: 'unity',
        status: 'pending',
        version: null,
        features: [],
        note: 'Importer/world/UGUI acceptance is pending Phase 10; no supported engine version is published yet.',
      },
      {
        id: 'cocos',
        status: 'pending',
        version: null,
        features: [],
        note: 'Creator importer/component/mobile and web acceptance is pending Phase 11.',
      },
    ],
  };
}
