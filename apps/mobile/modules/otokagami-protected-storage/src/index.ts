import { requireNativeModule } from "expo-modules-core";

export type ProtectedStoragePreparation = {
  databaseDirectoryUri: string;
};

type NativeModule = {
  prepare(): Promise<ProtectedStoragePreparation>;
  protectDatabase(databaseName: string): Promise<void>;
  storeAudio(sourceUri: string, fileKey: string): Promise<void>;
  deleteAudio(fileKey: string): Promise<void>;
  audioExists(fileKey: string): Promise<boolean>;
  resolveAudio(fileKey: string): Promise<string | null>;
};

export default requireNativeModule<NativeModule>("OtokagamiProtectedStorage");
