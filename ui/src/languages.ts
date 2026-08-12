/**
 * Dictation languages offered on the settings page.
 *
 * Deliberately a short, curated list rather than every BCP-47 tag: Web Speech
 * and Whisper support different sets, and a picker with 200 entries makes the
 * common case slower. The value is stored verbatim, so an install that needs
 * a tag missing here is one entry away.
 *
 * `label` is intentionally the language's own endonym: a Portuguese speaker
 * looking for their language scans for "Portugues", not "Portuguese".
 */
export type LanguageOption = { value: string; label: string };

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "pt-PT", label: "Portugues (Portugal)" },
  { value: "pt-BR", label: "Portugues (Brasil)" },
  { value: "es-ES", label: "Espanol (Espana)" },
  { value: "es-419", label: "Espanol (Latinoamerica)" },
  { value: "fr-FR", label: "Francais" },
  { value: "de-DE", label: "Deutsch" },
  { value: "it-IT", label: "Italiano" },
  { value: "nl-NL", label: "Nederlands" },
  { value: "pl-PL", label: "Polski" },
  { value: "ru-RU", label: "Russkiy" },
  { value: "tr-TR", label: "Turkce" },
  { value: "ja-JP", label: "Nihongo" },
  { value: "ko-KR", label: "Hangugeo" },
  { value: "zh-CN", label: "Zhongwen (Jianti)" },
  { value: "hi-IN", label: "Hindi" },
  { value: "ar-SA", label: "Arabiyya" },
];
