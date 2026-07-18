import { requireNativeModule } from "expo-modules-core";

export type StreamPreparation = {
  token: string;
  region: string;
  locale: string;
  referenceText: string;
  requestId: string;
};

export type NativeAssessmentResult = {
  requestId: string;
  rawJson: Record<string, unknown>;
  localAudioUri: string;
  audioDurationMs: number;
  recognitionLatencyMs: number | null;
  buttonToResultMs: number | null;
  recordingDurationMs: number | null;
  audioRms: number;
  audioPeak: number;
  activeFrameRatio: number;
};

type NativeModule = {
  prepare(options: StreamPreparation): Promise<{ preparedAtMs: number }>;
  start(requestId: string): Promise<{ recordingStartedAtMs: number }>;
  finish(requestId: string): Promise<NativeAssessmentResult>;
  cancel(requestId: string): Promise<void>;
  updateToken(token: string, requestId: string): Promise<void>;
};

export default requireNativeModule<NativeModule>("AzurePronunciationStream");
