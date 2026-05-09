import { useState } from "react";
import { Droplets } from "lucide-react";
import { supabase } from "../lib/supabase";

type AuthMode = "login" | "signup";

export function LoginPage() {
  const [email, setEmail] = useState("pooladmin@example.com");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setLoading(true);
    setError("");
    setSuccess("");

    if (mode === "login") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
      }
      setLoading(false);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      setSuccess("Account created. Redirecting to dashboard...");
    } else {
      setSuccess("Account created. Check your email to confirm before signing in.");
    }
    setLoading(false);
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">
          <Droplets size={34} />
        </div>
        <p className="eyebrow">Dedicated</p>
        <h1>{mode === "login" ? "Pool Dashboard" : "Create account"}</h1>
        <p className="login-copy">
          {mode === "login"
            ? "Control pump, heat, schedules, alerts, and energy from anywhere."
            : "Create your account to manage pool controls, schedules, and alerts."}
        </p>

        <div className="auth-toggle" role="tablist" aria-label="Authentication mode">
          <button
            className={mode === "login" ? "auth-toggle-button active" : "auth-toggle-button"}
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
              setSuccess("");
            }}
            disabled={loading}
          >
            Login
          </button>
          <button
            className={mode === "signup" ? "auth-toggle-button active" : "auth-toggle-button"}
            type="button"
            onClick={() => {
              setMode("signup");
              setError("");
              setSuccess("");
            }}
            disabled={loading}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </label>
          {success ? <div className="success-box">{success}</div> : null}
          {error ? <div className="error-box">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading
              ? mode === "login"
                ? "Signing in..."
                : "Creating account..."
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
