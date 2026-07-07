import { useState } from "react";
import { Mail, Lock, LogIn, ArrowRight, ArrowLeft, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase"; // adapte le chemin à ton projet

type Mode = "login" | "reset";

export default function LoginCard() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const resetMessages = () => {
    setError(null);
    setInfo(null);
  };

  const switchMode = (next: Mode) => {
    resetMessages();
    setMode(next);
  };

  const handleLogin = async () => {
    resetMessages();
    if (!email || !password) {
      setError("Renseigne ton email et ton mot de passe.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("Email ou mot de passe incorrect.");
    }
    // en cas de succès, ton listener onAuthStateChange / router prend le relais
  };

  const handleResetPassword = async () => {
    resetMessages();
    if (!email) {
      setError("Renseigne ton adresse email d'abord.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError("Impossible d'envoyer l'email pour le moment. Réessaie.");
    } else {
      // message neutre : ne jamais révéler si le compte existe
      setInfo("Si un compte existe pour cette adresse, un email de réinitialisation vient d'être envoyé.");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      mode === "login" ? handleLogin() : handleResetPassword();
    }
  };

  const firstName = "Jean"; // à remplacer par la vraie donnée si dispo

  return (
    <div className="w-full max-w-md rounded-3xl bg-white/80 backdrop-blur-xl shadow-2xl ring-1 ring-white/40 p-8 sm:p-10">
      {/* Eyebrow */}
      <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold tracking-wide text-blue-600">
        {mode === "login" ? <LogIn className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        {mode === "login" ? "CONNEXION" : "RÉINITIALISATION"}
      </div>

      {/* Titre */}
      <h2 className="mt-5 text-3xl font-bold text-slate-900">
        {mode === "login" ? (
          <>
            Heureux de vous revoir, <span className="text-blue-600">{firstName}</span>
          </>
        ) : (
          "Mot de passe oublié ?"
        )}
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        {mode === "login"
          ? "Connectez-vous pour accéder à votre compte Mimmoza."
          : "Indiquez votre email : nous vous enverrons un lien pour créer un nouveau mot de passe."}
      </p>

      {/* Messages */}
      {info && (
        <div className="mt-5 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{info}</span>
        </div>
      )}
      {error && (
        <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* Champ email (commun aux deux modes) */}
      <div className="mt-6">
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <div className="relative mt-1.5">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="vous@exemple.com"
            className="w-full rounded-xl border border-slate-200 bg-white/70 py-3 pl-10 pr-4 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      {/* Champ mot de passe (mode login uniquement) */}
      {mode === "login" && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Mot de passe
            </label>
            <button
              type="button"
              onClick={() => switchMode("reset")}
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Mot de passe oublié ?
            </button>
          </div>
          <div className="relative mt-1.5">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="••••••••••••"
              className="w-full rounded-xl border border-slate-200 bg-white/70 py-3 pl-10 pr-11 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Bouton principal */}
      <button
        type="button"
        onClick={mode === "login" ? handleLogin : handleResetPassword}
        disabled={loading}
        className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 py-3.5 font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:from-violet-700 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading
          ? "Un instant…"
          : mode === "login"
          ? "Se connecter"
          : "Envoyer le lien de réinitialisation"}
        {!loading && <ArrowRight className="h-4 w-4" />}
      </button>

      {/* Pied de carte contextuel */}
      {mode === "login" ? (
        <p className="mt-6 text-sm text-slate-500">
          Pas encore de compte ?{" "}
          <a href="/signup" className="font-semibold text-blue-600 hover:underline">
            Créer un compte
          </a>
        </p>
      ) : (
        <button
          type="button"
          onClick={() => switchMode("login")}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à la connexion
        </button>
      )}

      {/* Identifiant oublié → support */}
      <p className="mt-4 text-xs text-slate-400">
        Email oublié ?{" "}
        <a href="mailto:support@mimmoza.com" className="text-slate-500 hover:underline">
          Contacte le support
        </a>
      </p>

      {/* Liens légaux */}
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-5 text-xs text-slate-400">
        <a href="/mentions-legales" className="hover:text-slate-600">Mentions légales</a>
        <a href="/cgu" className="hover:text-slate-600">CGU</a>
        <a href="/cgv" className="hover:text-slate-600">CGV</a>
        <a href="/confidentialite" className="hover:text-slate-600">Confidentialité</a>
      </div>
    </div>
  );
}