import { Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { TitleGenerationSettings } from "../types";

interface EditableTitleGenerationSettings extends TitleGenerationSettings {
  apiKeyDraft: string;
  clearApiKey: boolean;
}

const DEFAULT_SETTINGS: EditableTitleGenerationSettings = {
  enabled: false,
  apiBaseUrl: "https://api.openai.com/v1",
  apiKeyConfigured: false,
  apiKeyDraft: "",
  clearApiKey: false,
  model: "gpt-4o-mini",
  timeoutMs: 10000
};

export function TitleGenerationSettingsPanel() {
  const [settings, setSettings] = useState<EditableTitleGenerationSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await api.titleGeneration();
        if (cancelled) return;
        setSettings(toEditableSettings(next));
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load title generation settings", loadError);
        setError("标题生成配置加载失败");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function update(patch: Partial<EditableTitleGenerationSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload: { enabled: boolean; apiBaseUrl: string; model: string; timeoutMs: number; apiKey?: string } = {
        enabled: settings.enabled,
        apiBaseUrl: settings.apiBaseUrl,
        model: settings.model,
        timeoutMs: settings.timeoutMs
      };
      if (settings.clearApiKey) {
        payload.apiKey = "";
      } else if (settings.apiKeyDraft.trim()) {
        payload.apiKey = settings.apiKeyDraft.trim();
      }
      const updated = await api.updateTitleGeneration(payload);
      setSettings(toEditableSettings(updated));
      setError(null);
    } catch (saveError) {
      console.error("Failed to save title generation settings", saveError);
      setError(saveError instanceof Error ? saveError.message : "标题生成配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="title-generation-settings notification-settings">
      <div className="notification-toolbar">
        <span>{loaded ? "标题生成" : "正在加载标题生成配置..."}</span>
        <button type="button" onClick={() => void save()} disabled={saving}>
          <Save size={14} />
          <span>{saving ? "保存中" : "保存配置"}</span>
        </button>
      </div>

      {error ? <div className="notification-error">{error}</div> : null}

      <section className="notification-card">
        <header>
          <strong>OpenAI-compatible</strong>
          <label className="notification-toggle">
            <span>{settings.enabled ? "已启用" : "关闭"}</span>
            <input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
          </label>
        </header>
        <div className="notification-field-grid">
          <label>
            <span>API URL</span>
            <input
              value={settings.apiBaseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(event) => update({ apiBaseUrl: event.target.value })}
            />
          </label>
          <label>
            <span>模型</span>
            <input
              value={settings.model}
              placeholder="gpt-4o-mini"
              onChange={(event) => update({ model: event.target.value })}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={settings.apiKeyDraft}
              placeholder={settings.apiKeyConfigured ? "已保存，留空不修改" : "sk-..."}
              onChange={(event) => update({ apiKeyDraft: event.target.value, clearApiKey: false })}
            />
          </label>
          <label>
            <span>Timeout</span>
            <input
              type="number"
              min={1000}
              max={60000}
              step={1000}
              value={settings.timeoutMs}
              onChange={(event) => update({ timeoutMs: Number(event.target.value) })}
            />
          </label>
        </div>
        {settings.apiKeyConfigured ? (
          <button className="notification-add-button" type="button" onClick={() => update({ apiKeyDraft: "", clearApiKey: true, apiKeyConfigured: false })}>
            <Trash2 size={14} />
            <span>清除 Key</span>
          </button>
        ) : null}
      </section>
    </div>
  );
}

function toEditableSettings(settings: TitleGenerationSettings): EditableTitleGenerationSettings {
  return {
    ...settings,
    apiKeyDraft: "",
    clearApiKey: false
  };
}
