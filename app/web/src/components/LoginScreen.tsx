import { FormEvent, useEffect, useState } from "react";

type LoginScreenProps = {
  onSubmit: (username: string, password: string, method: "username" | "email" | "both") => Promise<void>;
  onMicrosoftEntraSignIn?: () => void;
  loginMethod?: "username" | "email" | "both";
  logoDataUrl?: string;
  showPasswordForm?: boolean;
  defaultPasswordFormHidden?: boolean;
  authError?: string;
};

export function LoginScreen({
  onSubmit,
  onMicrosoftEntraSignIn,
  loginMethod = "username",
  logoDataUrl = "",
  showPasswordForm = true,
  defaultPasswordFormHidden = false,
  authError = "",
}: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [requiresMicrosoftMigration, setRequiresMicrosoftMigration] = useState(false);
  const [passwordFormVisible, setPasswordFormVisible] = useState(showPasswordForm && !defaultPasswordFormHidden);
  const migrationOnlyState = requiresMicrosoftMigration && Boolean(onMicrosoftEntraSignIn);
  const showPrimaryPasswordForm = showPasswordForm && passwordFormVisible;
  const showInlineMicrosoftDivider = Boolean(onMicrosoftEntraSignIn && showPasswordForm && !defaultPasswordFormHidden && !migrationOnlyState);
  const microsoftButtonClassName = `auth-provider-button ${showInlineMicrosoftDivider ? "auth-provider-button--inline" : "auth-provider-button--standalone"}`;

  const inputLabel = loginMethod === "email" ? "Email" : loginMethod === "both" ? "Email / Username" : "Username";
  const inputPlaceholder =
    loginMethod === "email"
      ? "name@company.com"
      : loginMethod === "both"
        ? "username or name@company.com"
        : "username";

  useEffect(() => {
    if (!showPasswordForm) {
      setPasswordFormVisible(false);
      return;
    }

    if (!defaultPasswordFormHidden) {
      setPasswordFormVisible(true);
    }
  }, [defaultPasswordFormHidden, showPasswordForm]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setRequiresMicrosoftMigration(false);
    try {
      await onSubmit(username, password, loginMethod as "username" | "email" | "both");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed. Check your credentials and login method.";
      setError(message);
      if (err && typeof err === "object" && "authState" in err) {
        const authState = (err as { authState?: { type?: string } }).authState;
        setRequiresMicrosoftMigration(authState?.type === "entra-migration-required");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="brand-lockup brand-lockup--auth">
          {logoDataUrl ? (
            <img alt="Sprinto logo" className="brand-logo brand-logo--auth" src={logoDataUrl} />
          ) : (
            <strong className="brand-text brand-text--auth">SPRINTO</strong>
          )}
        </div>

        <div className="auth-card__content">
          {migrationOnlyState ? (
            <div className="auth-card__panel auth-card__panel--migration">
              <div className="auth-migration-panel" role="status">
                <div className="auth-migration-panel__body">
                  <strong>Microsoft Entra required</strong>
                  <p>{error || authError || "This account must now sign in with Microsoft Entra."}</p>
                </div>
                <button className="auth-provider-button auth-provider-button--standalone" onClick={onMicrosoftEntraSignIn} type="button">
                  <span className="auth-provider-button__icon" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>Sign in with Microsoft</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="auth-card__panel auth-card__panel--default">
              {onMicrosoftEntraSignIn && !showInlineMicrosoftDivider ? (
                <div className="auth-provider-actions">
                  <button className={microsoftButtonClassName} onClick={onMicrosoftEntraSignIn} type="button">
                    <span className="auth-provider-button__icon" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    <span>Sign in with Microsoft</span>
                  </button>
                </div>
              ) : null}

              {showPasswordForm && defaultPasswordFormHidden && !passwordFormVisible ? (
                <button className="ghost-button auth-provider-link" onClick={() => setPasswordFormVisible(true)} type="button">
                  Use recovery account
                </button>
              ) : null}

              {showPrimaryPasswordForm ? (
                <form className="stack-form" onSubmit={handleSubmit}>
                  <label>
                    {inputLabel}
                    <input placeholder={inputPlaceholder} value={username} onChange={(event) => setUsername(event.target.value)} />
                  </label>
                  <label>
                    Password
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                  </label>
                  <button disabled={submitting} type="submit">
                    {submitting ? "Signing in..." : "Sign in"}
                  </button>
                  {showInlineMicrosoftDivider ? (
                    <div className="auth-provider-divider" aria-hidden="true">
                      <span>OR</span>
                    </div>
                  ) : null}
                  {showInlineMicrosoftDivider ? (
                    <button className={microsoftButtonClassName} onClick={onMicrosoftEntraSignIn} type="button">
                      <span className="auth-provider-button__icon" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                      <span>Sign in with Microsoft</span>
                    </button>
                  ) : null}
                  {error || authError ? <p className="error-text">{error || authError}</p> : null}
                </form>
              ) : authError ? (
                <p className="error-text">{authError}</p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
