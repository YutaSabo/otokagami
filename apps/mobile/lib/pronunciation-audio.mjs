export function classifyAudioActivity({ frameRms, peak }) {
  if (!Array.isArray(frameRms) || frameRms.length === 0) {
    return { hasSpeech: false, activeFrameRatio: 0, noiseFloorRms: 0 };
  }
  const sorted = [...frameRms].sort((a, b) => a - b);
  const noiseFloorRms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 5))];
  const activeThreshold = Math.max(180, noiseFloorRms * 2.5);
  const activeFrames = frameRms.filter((value) => value >= activeThreshold).length;
  const activeFrameRatio = activeFrames / frameRms.length;
  return {
    hasSpeech:
      peak >= 600 && Math.max(...frameRms) >= 250 && activeFrames >= 2 && activeFrameRatio >= 0.02,
    activeFrameRatio,
    noiseFloorRms
  };
}
