/**
 * Settings > Plugins > Voice Mode. Per-user dictation preferences; the
 * operator's OpenAI key lives in the manifest-declared config form kandev
 * renders above this page.
 */
import { useCallback, useEffect, useState } from "react";
import { host } from "./host";
import { detectVoiceCapabilities } from "./capabilities";
import { LANGUAGE_OPTIONS } from "./languages";
import { formatApproxSize, WHISPER_WEB_MODELS } from "./models";
import { t, type StringKey } from "./strings";
import {
  updateSettings,
  type VoiceEngine,
  type VoiceActivationMode,
  type WhisperWebModelSize,
} from "./settings";
import { useServerRelayAvailable, useVoiceSettings } from "./use-dictation";

type UiExports = {
  Card: React.ComponentType<Record<string, unknown>>;
  CardContent: React.ComponentType<Record<string, unknown>>;
  CardDescription: React.ComponentType<Record<string, unknown>>;
  CardHeader: React.ComponentType<Record<string, unknown>>;
  CardTitle: React.ComponentType<Record<string, unknown>>;
  Label: React.ComponentType<Record<string, unknown>>;
  Switch: React.ComponentType<Record<string, unknown>>;
  Select: React.ComponentType<Record<string, unknown>>;
  SelectContent: React.ComponentType<Record<string, unknown>>;
  SelectItem: React.ComponentType<Record<string, unknown>>;
  SelectTrigger: React.ComponentType<Record<string, unknown>>;
  SelectValue: React.ComponentType<Record<string, unknown>>;
  Alert: React.ComponentType<Record<string, unknown>>;
  AlertDescription: React.ComponentType<Record<string, unknown>>;
  Separator: React.ComponentType<Record<string, unknown>>;
};

function ui(): UiExports {
  return host().ui as unknown as UiExports;
}

/** One labelled control with its always-visible explanation underneath. */
function Field({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string;
  help: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const { Label } = ui();
  return (
    <div className="kv-field">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      <p className="kv-help">{help}</p>
    </div>
  );
}

function ToggleField({
  label,
  help,
  checked,
  onChange,
  testId,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  const { Label, Switch } = ui();
  return (
    <div className="kv-field">
      <div className="kv-field__row">
        <Label htmlFor={testId}>{label}</Label>
        <Switch
          id={testId}
          data-testid={testId}
          checked={checked}
          onCheckedChange={onChange}
          className="kv-cursor-pointer"
        />
      </div>
      <p className="kv-help">{help}</p>
    </div>
  );
}

type EngineOption = { value: VoiceEngine; labelKey: StringKey; helpKey: StringKey; available: boolean };

function useEngineOptions(): EngineOption[] {
  const caps = detectVoiceCapabilities();
  const relayAvailable = useServerRelayAvailable();
  return [
    { value: "auto", labelKey: "settingsEngineAuto", helpKey: "settingsEngineAutoHelp", available: true },
    {
      value: "webSpeech",
      labelKey: "settingsEngineWebSpeech",
      helpKey: "settingsEngineWebSpeechHelp",
      available: caps.webSpeech,
    },
    {
      value: "whisperWeb",
      labelKey: "settingsEngineWhisperWeb",
      helpKey: "settingsEngineWhisperWebHelp",
      available: caps.whisperWeb,
    },
    {
      value: "whisperServer",
      labelKey: "settingsEngineWhisperServer",
      helpKey: "settingsEngineWhisperServerHelp",
      available: caps.audioCapture && relayAvailable !== false,
    },
  ];
}

function EngineHelp({ options, selected }: { options: EngineOption[]; selected: VoiceEngine }) {
  const active = options.find((option) => option.value === selected);
  if (!active) return null;
  const size = formatApproxSize(WHISPER_WEB_MODELS.base.approxBytes);
  return (
    <p className="kv-help">
      {t(active.helpKey, { size })}
      {!active.available ? ` ${t("settingsEngineUnavailable")}` : ""}
    </p>
  );
}

export function VoiceSettingsPage() {
  const { Card, CardContent, CardDescription, CardHeader, CardTitle } = ui();
  const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = ui();
  const { Alert, AlertDescription, Separator } = ui();
  const settings = useVoiceSettings();
  const engineOptions = useEngineOptions();
  const relayAvailable = useServerRelayAvailable();
  const [secureContext, setSecureContext] = useState(true);

  useEffect(() => {
    setSecureContext(typeof window === "undefined" ? true : window.isSecureContext);
  }, []);

  const save = useCallback((patch: Parameters<typeof updateSettings>[0]) => {
    void updateSettings(patch).catch(() => host().toast.error(t("settingsSaveFailed")));
  }, []);

  return (
    <Card data-testid="voice-plugin-settings">
      <CardHeader>
        <CardTitle>{t("settingsTitle")}</CardTitle>
        <CardDescription>{t("settingsSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="kv-settings">
        {!secureContext && (
          <Alert variant="destructive">
            <AlertDescription>{t("settingsInsecureContext")}</AlertDescription>
          </Alert>
        )}

        <ToggleField
          testId="voice-plugin-enabled"
          label={t("settingsEnabledLabel")}
          help={t("settingsEnabledHelp")}
          checked={settings.enabled}
          onChange={(enabled) => save({ enabled })}
        />

        <Separator />

        <Field label={t("settingsEngineLabel")} help={t("settingsEngineHelp")}>
          <Select
            value={settings.engine}
            onValueChange={(engine: string) => save({ engine: engine as VoiceEngine })}
          >
            <SelectTrigger className="kv-cursor-pointer" data-testid="voice-plugin-engine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {engineOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="kv-cursor-pointer">
                  {t(option.labelKey)}
                  {!option.available ? ` (${t("settingsEngineUnavailable")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <EngineHelp options={engineOptions} selected={settings.engine} />

        {relayAvailable === false && (
          <Alert>
            <AlertDescription>{t("settingsRelayUnconfigured")}</AlertDescription>
          </Alert>
        )}

        <Field label={t("settingsLanguageLabel")} help={t("settingsLanguageHelp")}>
          <Select value={settings.language} onValueChange={(language: string) => save({ language })}>
            <SelectTrigger className="kv-cursor-pointer" data-testid="voice-plugin-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="kv-cursor-pointer">
                {t("settingsLanguageAuto")}
              </SelectItem>
              {LANGUAGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="kv-cursor-pointer">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t("settingsModelLabel")} help={t("settingsModelHelp")}>
          <Select
            value={settings.whisperWebModel}
            onValueChange={(model: string) => save({ whisperWebModel: model as WhisperWebModelSize })}
          >
            <SelectTrigger className="kv-cursor-pointer" data-testid="voice-plugin-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(WHISPER_WEB_MODELS).map((model) => (
                <SelectItem key={model.size} value={model.size} className="kv-cursor-pointer">
                  {t("settingsModelOption", {
                    label: model.label,
                    size: formatApproxSize(model.approxBytes),
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t("settingsActivationLabel")} help={t("settingsActivationHelp")}>
          <Select
            value={settings.mode}
            onValueChange={(mode: string) => save({ mode: mode as VoiceActivationMode })}
          >
            <SelectTrigger className="kv-cursor-pointer" data-testid="voice-plugin-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="toggle" className="kv-cursor-pointer">
                {t("settingsActivationToggle")}
              </SelectItem>
              <SelectItem value="hold" className="kv-cursor-pointer">
                {t("settingsActivationHold")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <ToggleField
          testId="voice-plugin-auto-send"
          label={t("settingsAutoSendLabel")}
          help={t("settingsAutoSendHelp")}
          checked={settings.autoSend}
          onChange={(autoSend) => save({ autoSend })}
        />

        <p className="kv-help">{t("settingsShortcutHint")}</p>
      </CardContent>
    </Card>
  );
}
