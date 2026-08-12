/**
 * Plugin-owned copy.
 *
 * Kandev has no host i18n API for plugins yet (deliberately: see
 * docs/specs/plugins/voice-extraction-host.md, "Plugin localization is a
 * separately scoped prerequisite"). Rather than hardcode literals across the
 * components, every string lives here behind a `t()` that already takes a key
 * and interpolation values. When the host does publish a locale API, this
 * module is the only file that has to learn about it.
 */

const EN = {
  // Composer action
  actionLabelIdle: "Start dictation",
  actionLabelRequesting: "Requesting microphone permission",
  actionLabelRecording: "Stop dictation",
  actionLabelProcessing: "Transcribing dictation",
  tooltipIdle: "Dictate",
  tooltipRequesting: "Requesting microphone",
  tooltipRecording: "Stop recording",
  tooltipProcessing: "Transcribing",
  tooltipHold: "{{tooltip}} (hold to talk)",
  tooltipDownloading: "Downloading {{modelLabel}} ({{pct}}%)",
  unavailableTitle: "Dictation unavailable",
  unavailableTapForDetails: "Dictation unavailable. Select for details.",
  unavailableInsecure:
    "Microphone access needs a secure page. Open kandev over https:// or on http://localhost.",
  unavailableBrowser: "This browser has no dictation engine kandev can use.",
  unavailableHere: "Dictation is not available here.",
  modelDownloading: "Downloading {{modelLabel}}",

  // Errors
  errPermissionDenied: "Microphone permission denied.",
  errNoSpeech: "No speech detected. Try again.",
  errSpeechNetwork: "Speech recognition lost its network connection.",
  errNoMicrophone: "No microphone was found.",
  errSpeechGeneric: "Speech recognition error: {{code}}",
  errRecordingStart: "Could not start recording.",
  errRelayNotConfigured:
    "Server transcription has no API key. Pick Browser speech or In-browser Whisper in Voice Mode settings.",
  errRecordingTooLong: "That recording is too long to transcribe. Try a shorter one.",
  errTranscriptionFailed: "Transcription failed. Please try again.",
  errWhisperFailed: "In-browser Whisper could not transcribe that recording.",
  errComposerGone: "The composer moved on before the transcript was ready.",

  // Settings page
  settingsTitle: "Voice Mode",
  settingsSubtitle: "Dictate prompts into any kandev composer.",
  settingsEnabledLabel: "Enable dictation",
  settingsEnabledHelp:
    "Shows the microphone button in task chat, Quick Chat, task creation and new-session creation. Turning it off hides the button everywhere and stops the keyboard shortcut; nothing else changes.",
  settingsEngineLabel: "Engine",
  settingsEngineHelp:
    "Which recognizer turns your speech into text. Automatic picks the first one this browser can run, in the order listed below.",
  settingsEngineAuto: "Automatic",
  settingsEngineAutoHelp:
    "Browser speech first, then in-browser Whisper, then server transcription.",
  settingsEngineWebSpeech: "Browser speech",
  settingsEngineWebSpeechHelp:
    "Fastest and free, no download. Chromium browsers only, and the audio is sent to the browser vendor for recognition.",
  settingsEngineWhisperWeb: "In-browser Whisper",
  settingsEngineWhisperWebHelp:
    "Private: the audio never leaves this device. Downloads the model once ({{size}}) and needs a few seconds per recording.",
  settingsEngineWhisperServer: "Server transcription",
  settingsEngineWhisperServerHelp:
    "Most accurate and works in every browser. Uploads the audio to your kandev server, which relays it to OpenAI and is billed per minute.",
  settingsEngineUnavailable: "Not available in this browser.",
  settingsRelayUnconfigured:
    "No OpenAI key is saved for this install, so server transcription is unavailable. An admin can add one in the plugin settings above.",
  settingsLanguageLabel: "Language",
  settingsLanguageHelp:
    "The language you dictate in. Automatic follows this browser's language, which is wrong more often than picking explicitly if you speak a second language.",
  settingsLanguageAuto: "Automatic (browser language)",
  settingsModelLabel: "Whisper model",
  settingsModelHelp:
    "Bigger models are more accurate and slower, and are downloaded once per browser. Only used by the in-browser Whisper engine.",
  settingsModelOption: "{{label}} ({{size}})",
  settingsActivationLabel: "Activation",
  settingsActivationHelp:
    "Toggle starts on the first press and stops on the second. Hold records only while the button stays pressed. Touch devices always use toggle, because the system can reclaim a held finger mid-sentence.",
  settingsActivationToggle: "Press to start, press to stop",
  settingsActivationHold: "Hold to talk",
  settingsAutoSendLabel: "Send as soon as I stop talking",
  settingsAutoSendHelp:
    "Submits the composer right after the transcript is inserted, with no chance to read it first. The composer's own rules still apply, so a blocked form is never submitted.",
  settingsShortcutHint:
    "The dictation shortcut is listed under Settings > Keyboard shortcuts and can be rebound there.",
  settingsSaveFailed: "Could not save your Voice Mode settings.",
  settingsInsecureContext:
    "This page is not a secure context, so no engine can reach the microphone. Open kandev over https:// or on http://localhost.",
} as const;

export type StringKey = keyof typeof EN;

export function t(key: StringKey, values?: Record<string, string | number>): string {
  const template: string = EN[key];
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
