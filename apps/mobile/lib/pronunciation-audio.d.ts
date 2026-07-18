export function classifyAudioActivity(input: { frameRms: number[]; peak: number }): {
  hasSpeech: boolean;
  activeFrameRatio: number;
  noiseFloorRms: number;
};
