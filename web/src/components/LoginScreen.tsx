import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";

interface LoginScreenProps {
  loading: boolean;
  error: string | null;
  savedPasswordEnabled: boolean;
  onLogin: (password: string, remember: boolean) => Promise<void>;
}

export function LoginScreen({ loading, error, savedPasswordEnabled, onLogin }: LoginScreenProps) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(savedPasswordEnabled);
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <main className="login-screen">
      <form
        className="login-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void onLogin(password, remember).catch(() => undefined);
        }}
      >
        <div className="login-mark">
          <ShieldCheck size={22} />
          <span>Codex Web</span>
        </div>
        <header>
          <h1>需要验证</h1>
          <p>局域网访问已受保护</p>
        </header>
        <label className="login-field">
          <span>密码</span>
          <div>
            <LockKeyhole size={15} />
            <input
              autoFocus
              type={passwordVisible ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入访问密码"
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
        <label className="login-remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>在本机保存登录凭证</span>
        </label>
        {error ? <div className="login-error">{error}</div> : null}
        <button className="login-submit" type="submit" disabled={loading || !password.trim()}>
          {loading ? "验证中..." : "进入"}
        </button>
      </form>
    </main>
  );
}
