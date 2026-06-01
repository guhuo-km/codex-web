import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AuthSettings } from "../types";

interface SecuritySettingsPanelProps {
  authEnabled: boolean;
  authenticated: boolean;
  savedPasswordEnabled: boolean;
  onAuthSettingsChange: () => void;
  onClearSavedPassword: () => void;
  onLogout: () => void | Promise<void>;
}

export function SecuritySettingsPanel({ authEnabled, authenticated, savedPasswordEnabled, onAuthSettingsChange, onClearSavedPassword, onLogout }: SecuritySettingsPanelProps) {
  const [settings, setSettings] = useState<AuthSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [savedPassword, setSavedPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await api.authSettings();
        if (cancelled) return;
        setSettings(next);
        setSavedPassword(next.password);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load auth settings", loadError);
        setError("安全设置加载失败");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateSettings(patch: Partial<AuthSettings>) {
    if (!settings) return;
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateAuthSettings(patch);
      setSettings(saved);
      setSavedPassword(saved.password);
      onAuthSettingsChange();
      if (patch.password !== undefined) {
        onClearSavedPassword();
      }
    } catch (saveError) {
      console.error("Failed to save auth settings", saveError);
      setSettings(settings);
      setError("安全设置保存失败");
    } finally {
      setSaving(false);
    }
  }

  const effectiveEnabled = settings?.enabled ?? authEnabled;

  return (
    <div className="security-settings">
      <label className="settings-option">
        <span>
          <strong>访问密码</strong>
          <small>{effectiveEnabled ? "已启用，配置会写入 .evn。" : "当前未启用访问密码。"}</small>
        </span>
        <input
          type="checkbox"
          checked={effectiveEnabled}
          disabled={!loaded || saving}
          onChange={(event) => void updateSettings({ enabled: event.target.checked })}
        />
      </label>

      <label className="settings-option security-password-setting">
        <span>
          <strong>.evn 密码</strong>
          <small>修改后立即写入 CODEX_WEB_PASSWORD。</small>
        </span>
        <div className="settings-password-field">
          <input
            type={passwordVisible ? "text" : "password"}
            value={settings?.password ?? ""}
            placeholder={loaded ? "输入访问密码" : "加载中..."}
            disabled={!loaded || saving}
            onChange={(event) => setSettings((current) => current ? { ...current, password: event.target.value } : current)}
            onBlur={(event) => {
              const nextPassword = event.currentTarget.value.trim();
              if (!settings || nextPassword === savedPassword || !nextPassword) return;
              void updateSettings({ password: nextPassword });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
          <button
            type="button"
            className="password-visibility-button"
            aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
            onClick={() => setPasswordVisible((current) => !current)}
          >
            {passwordVisible ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </label>

      <div className="settings-option">
        <span>
          <strong>当前会话</strong>
          <small>{authenticated ? "这个浏览器已通过验证。" : "这个浏览器尚未通过验证。"}</small>
        </span>
        <button className="settings-inline-button" type="button" onClick={() => void onLogout()} disabled={!authenticated}>
          退出登录
        </button>
      </div>

      <div className="settings-option">
        <span>
          <strong>登录凭证</strong>
          <small>{savedPasswordEnabled ? "已保存在本机浏览器，下次打开会自动登录。" : "未保存，重新打开时需要手动输入。"}</small>
        </span>
        <button className="settings-inline-button" type="button" onClick={onClearSavedPassword} disabled={!savedPasswordEnabled}>
          清除登录凭证
        </button>
      </div>

      {saving ? <div className="settings-status">正在保存...</div> : null}
      {error ? <div className="settings-error">{error}</div> : null}
    </div>
  );
}
