import type { WhisperWebModelSize } from "./settings";

export type WhisperModelConfig = {
  size: WhisperWebModelSize;
  /**
   * Hugging Face model id. Use the `onnx-community/*` mirrors: the older
   * `Xenova/whisper-*` ones default to 4-bit (`MatMulNBits`) weights that only
   * run on WebGPU and fail on WASM with
   * `Missing required scale: ... weight_merged_0_scale`.
   */
  modelId: string;
  /** Rough on-disk size after download, shown on the settings page. */
  approxBytes: number;
  label: string;
};

export const WHISPER_WEB_MODELS: Record<WhisperWebModelSize, WhisperModelConfig> = {
  tiny: {
    size: "tiny",
    modelId: "onnx-community/whisper-tiny",
    approxBytes: 40 * 1024 * 1024,
    label: "Whisper Tiny",
  },
  base: {
    size: "base",
    modelId: "onnx-community/whisper-base",
    approxBytes: 75 * 1024 * 1024,
    label: "Whisper Base",
  },
  small: {
    size: "small",
    modelId: "onnx-community/whisper-small",
    approxBytes: 240 * 1024 * 1024,
    label: "Whisper Small",
  },
};

export function whisperModelConfig(size: WhisperWebModelSize): WhisperModelConfig {
  return WHISPER_WEB_MODELS[size] ?? WHISPER_WEB_MODELS.base;
}

export function formatApproxSize(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
