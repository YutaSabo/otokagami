import ProtectedStorage from "otokagami-protected-storage";

export type V2DevBuildDiagnostic = {
  nativeProtectedStorage: boolean;
  databaseDirectoryIsApplicationSupport: boolean;
  releaseCaptureDisabled: boolean;
};

export async function diagnoseV2DevBuild(): Promise<V2DevBuildDiagnostic> {
  const prepared=await ProtectedStorage.prepare();
  return {
    nativeProtectedStorage:true,
    databaseDirectoryIsApplicationSupport:/Application Support|Application%20Support/.test(prepared.databaseDirectoryUri),
    releaseCaptureDisabled:process.env.EXPO_PUBLIC_V2_CAPTURE_FIXTURE!=="true"
  };
}
