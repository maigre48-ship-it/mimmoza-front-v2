// src/spaces/particulier/pages/ConnexionPage.tsx
// ─── changelog ───────────────────────────────────────────────────────────────
// • handleLogin → redirige vers /dashboard (plus vers /abonnement)
// • Audio robuste : autoplay + fallback bouton son
// • Connexion temporaire via localStorage
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Volume2,
} from "lucide-react";
import AnimatedWaveBackground from "@/components/backgrounds/AnimatedWaveBackground";

type StoredUser = {
  email?: string;
  logged?: boolean;
  fullName?: string;
  plan?: string;
};

export default function ConnexionPage() {
  const navigate = useNavigate();

  const storedUser = useMemo<StoredUser>(() => {
    try {
      const raw = localStorage.getItem("mimmoza.user");
      return raw ? (JSON.parse(raw) as StoredUser) : {};
    } catch {
      return {};
    }
  }, []);

  const [email, setEmail] = useState(storedUser.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showSoundBtn, setShowSoundBtn] = useState(false);

  const firstName = storedUser.fullName?.trim().split(/\s+/)[0] ?? "";

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio("/sons/son_intro.mp3");
    audio.volume = 0.8;
    audioRef.current = audio;

    audio
      .play()
      .then(() => setShowSoundBtn(false))
      .catch(() => setShowSoundBtn(true));

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  const handleSoundBtn = () => {
    audioRef.current?.play().catch(console.warn);
    setShowSoundBtn(false);
  };

  // ── Connexion : toujours vers /dashboard ────────────────────────────────
  const handleLogin = () => {
    localStorage.setItem(
      "mimmoza.user",
      JSON.stringify({
        email,
        logged: true,
        fullName: storedUser.fullName ?? "",
        plan: storedUser.plan ?? "free",
      })
    );

    localStorage.setItem("mimmoza-auth", "true");

    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedWaveBackground />

      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:py-14">
        <div className="flex flex-col justify-center">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-sky-200/70 bg-white/60 px-4 py-2 text-sm font-medium text-sky-700 shadow-sm backdrop-blur-sm">
            <Sparkles className="h-4 w-4" />
            Espace compte Mimmoza
          </div>

          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Connectez-vous à votre{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent">
              espace personnel
            </span>
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600/90">
            Accédez à votre compte, à vos futurs abonnements et à l'ensemble de
            votre environnement Mimmoza dans une interface claire et premium.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/60 bg-white/50 p-4 shadow-sm backdrop-blur-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Accès sécurisé
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                Connexion simple avant branchement complet Supabase Auth.
              </div>
            </div>

            <div className="rounded-2xl border border-white/60 bg-white/50 p-4 shadow-sm backdrop-blur-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CheckCircle2 className="h-4 w-4 text-sky-500" />
                Parcours prêt
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                Base prête pour abonnement, portail client et monétisation.
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center">
          <div className="w-full rounded-3xl border border-white/70 bg-white/75 p-6 shadow-[0_8px_40px_rgba(59,130,246,0.12)] backdrop-blur-md sm:p-8">
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-50/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-600">
                <LogIn className="h-3.5 w-3.5" />
                Connexion
              </div>

              <h2 className="mt-4 text-2xl font-semibold text-slate-900">
                {firstName ? (
                  <>
                    Heureux de vous revoir,{" "}
                    <span className="bg-gradient-to-r from-indigo-600 to-sky-500 bg-clip-text text-transparent">
                      {firstName}
                    </span>
                  </>
                ) : (
                  "Heureux de vous revoir"
                )}
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Connectez-vous pour accéder à votre compte Mimmoza.
              </p>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Email
                </span>

                <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 transition-all focus-within:border-sky-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-sky-100/70">
                  <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    type="email"
                    placeholder="nom@exemple.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Mot de passe
                </span>

                <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 transition-all focus-within:border-sky-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-sky-100/70">
                  <Lock className="h-4 w-4 shrink-0 text-slate-400" />

                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Votre mot de passe"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                    aria-label={showPassword ? "Masquer" : "Afficher"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </label>

              <button
                type="button"
                onClick={handleLogin}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-sky-500 px-5 py-3.5 text-sm font-medium text-white shadow-md shadow-sky-200/60 transition-all hover:from-indigo-500 hover:to-sky-400"
              >
                <span>Se connecter</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 text-sm text-slate-500">
              Pas encore de compte ?{" "}
              <Link
                to="/inscription"
                className="font-medium text-sky-600 transition hover:text-sky-700"
              >
                Créer un compte
              </Link>
            </div>
          </div>
        </div>
      </div>

      {showSoundBtn && (
        <button
          type="button"
          onClick={handleSoundBtn}
          title="Activer le son d'intro"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-xs font-medium text-sky-700 shadow-md backdrop-blur-sm transition hover:bg-white"
        >
          <Volume2 className="h-4 w-4" />
          Activer le son
        </button>
      )}
    </div>
  );
}