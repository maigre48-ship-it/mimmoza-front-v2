// src/pages/LoginPage.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function LoginPage(): React.ReactElement {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        throw signInError;
      }

      if (data.session) {
        navigate("/promoteur/plu-faisabilite");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur lors de la connexion.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Connexion</h1>
        <p style={styles.subtitle}>Connectez-vous pour accÃ©der Ã  Mimmoza</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="votre@email.com"
              required
              disabled={loading}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
              required
              disabled={loading}
              style={styles.input}
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "#f9fafb",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    padding: 32,
    background: "#ffffff",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
    border: "1px solid #e5e7eb",
  },
  title: {
    margin: "0 0 8px 0",
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#111827",
    textAlign: "center" as const,
  },
  subtitle: {
    margin: "0 0 24px 0",
    fontSize: "0.875rem",
    color: "#6b7280",
    textAlign: "center" as const,
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  label: {
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "#374151",
  },
  input: {
    padding: "10px 12px",
    fontSize: "1rem",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    outline: "none",
    transition: "border-color 0.15s",
  },
  error: {
    padding: 12,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#b91c1c",
    fontSize: "0.875rem",
  },
  button: {
    marginTop: 8,
    padding: "12px 16px",
    fontSize: "1rem",
    fontWeight: 600,
    color: "#ffffff",
    background: "#111827",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    transition: "opacity 0.15s",
  },
};
