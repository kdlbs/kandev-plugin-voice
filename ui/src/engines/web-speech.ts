/**
 * The browser's own SpeechRecognition engine. Cheapest and lowest latency,
 * but only Chromium ships it, and it streams audio to the vendor's servers.
 */

type SpeechAlt = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechAlt; length: number };
type SpeechResultList = { length: number; [index: number]: SpeechResult };
export type SpeechResultEvent = { resultIndex: number; results: SpeechResultList };
export type SpeechErrorEvent = { error: string; message?: string };

export type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechResultEvent) => void) | null;
  onerror: ((ev: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechCtor = new () => SpeechRecognitionInstance;

export function createSpeechRecognition(): SpeechRecognitionInstance | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Collects the final results of one recognition run into a single string. */
export function collectFinalTranscripts(
  event: SpeechResultEvent,
  into: string[],
): void {
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    if (result?.isFinal && result[0]?.transcript) into.push(result[0].transcript.trim());
  }
}
