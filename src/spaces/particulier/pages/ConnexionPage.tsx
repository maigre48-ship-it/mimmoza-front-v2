// src/spaces/particulier/pages/ConnexionPage.tsx

import AnimatedWaveBackground from "@/components/backgrounds/AnimatedWaveBackground";
import { supabase } from "@/lib/supabase";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

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
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const firstName = storedUser.fullName?.trim().split(/\s+/)[0] ?? "";

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setLoginError("Veuillez renseigner votre email et votre mot de passe.");
      return;
    }

    setLoginLoading(true);
    setLoginError(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.session) {
        const msg = (error?.message ?? "").toLowerCase();
        if (msg.includes("email not confirmed")) {
          setLoginError("Votre adresse email n'a pas encore été confirmée. Vérifiez votre boîte mail.");
        } else {
          setLoginError(
            "Identifiants incorrects. Si vous aviez supprimé ce compte, il n'existe plus : créez-en un nouveau."
          );
        }
        return;
      }

      const user = data.user;

      // Récupère le fullName depuis user_metadata si disponible
      const fullName =
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        storedUser.fullName ??
        "";

      // Récupère le plan depuis la table profiles si elle existe, sinon garde l'existant
      let plan = storedUser.plan ?? "free";
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("plan")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.plan) plan = profile.plan as string;
      } catch {
        // table profiles absente ou inaccessible — on garde le plan existant
      }

      localStorage.setItem(
        "mimmoza.user",
        JSON.stringify({
          email: user.email,
          logged: true,
          fullName,
          plan,
        })
      );

      localStorage.setItem("mimmoza-auth", "true");

      navigate("/dashboard", { replace: true });
    } catch {
      setLoginError("Une erreur est survenue. Veuillez réessayer.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
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
                Authentification Supabase Auth avec session JWT persistée.
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
                    onKeyDown={handleKeyDown}
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
                    onKeyDown={handleKeyDown}
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

              {loginError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {loginError}
                </div>
              )}

              <button
                type="button"
                onClick={handleLogin}
                disabled={loginLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-sky-500 px-5 py-3.5 text-sm font-medium text-white shadow-md shadow-sky-200/60 transition-all hover:from-indigo-500 hover:to-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{loginLoading ? "Connexion en cours..." : "Se connecter"}</span>
                {!loginLoading && <ArrowRight className="h-4 w-4" />}
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

            <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-slate-200 pt-4 text-xs text-slate-500">
              <Link to="/mentions-legales" className="hover:text-slate-900 transition-colors">
                Mentions légales
              </Link>
              <Link to="/cgu" className="hover:text-slate-900 transition-colors">
                CGU
              </Link>
              <Link to="/cgv" className="hover:text-slate-900 transition-colors">
                CGV
              </Link>
              <Link
                to="/politique-confidentialite"
                className="hover:text-slate-900 transition-colors"
              >
                Confidentialité
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}