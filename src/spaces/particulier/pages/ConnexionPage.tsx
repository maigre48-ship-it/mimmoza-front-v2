// src/spaces/particulier/pages/ConnexionPage.tsx

import mimmozaLogo from "@/assets/mimmoza-logo.png";
import { supabase } from "@/lib/supabase";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  Euro,
  Eye,
  EyeOff,
  FileText,
  Home,
  LayoutDashboard,
  Lock,
  LogIn,
  Mail,
  MapPin,
  Ruler,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCurrentAdminStatus } from "@/lib/admin";

type StoredUser = {
  email?: string;
  logged?: boolean;
  fullName?: string;
  plan?: string;
};

type Mode = "login" | "reset";
type PropertyType = "" | "appartement" | "maison";

const PRO_MENU: { label: string; to: string }[] = [
  { label: "Investissement", to: "/marchand-de-bien" },
  { label: "Promotion", to: "/promoteur" },
  { label: "Réhabilitation", to: "/rehabilitation" },
  { label: "Apport d'affaires", to: "/apporteur" },
];

const EXPRESS_BENEFITS = [
  { icon: Search, label: "Analyse rapide et fiable" },
  { icon: Database, label: "Donnees de marche & risques inclus" },
  { icon: FileText, label: "Rapport PDF immediat" },
];

const PRO_BENEFITS = [
  { icon: ChartNoAxesCombined, label: "Tableaux de bord avances" },
  { icon: Building2, label: "Etudes de faisabilite & scenarios" },
  { icon: Search, label: "Veille marche & opportunites" },
  { icon: FileText, label: "Rapports detailles & exports" },
  { icon: Code2, label: "API & integrations" },
];

const TRUST_ITEMS = [
  { icon: BadgeCheck, title: "Données certifiées", subtitle: "DVF, PLU, Cadastre" },
  { icon: ShieldCheck, title: "Sécurisé & confidentiel", subtitle: "Conforme RGPD" },
];

export default function ConnexionPage() {
  const navigate = useNavigate();
  const proRef = useRef<HTMLDivElement | null>(null);

  const storedUser = useMemo<StoredUser>(() => {
    try {
      const raw = localStorage.getItem("mimmoza.user");
      return raw ? (JSON.parse(raw) as StoredUser) : {};
    } catch {
      return {};
    }
  }, []);

  // Auth Pro (logique existante conservee)
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState(storedUser.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  // Analyse Express
  const [expressAddress, setExpressAddress] = useState("");
  const [expressCity, setExpressCity] = useState("");
  const [expressPostalCode, setExpressPostalCode] = useState("");
  const [expressSurface, setExpressSurface] = useState("");
  const [expressPrice, setExpressPrice] = useState("");
  const [expressPropertyType, setExpressPropertyType] = useState<PropertyType>("");
  const [expressError, setExpressError] = useState<string | null>(null);

  const [proMenuOpen, setProMenuOpen] = useState(false);
  const proMenuRef = useRef<HTMLDivElement | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getCurrentAdminStatus()
      .then((r) => {
        if (mounted) setIsAdmin(r.isAdmin);
      })
      .catch(() => {
        /* non connecte : pas admin */
      });
    const sub = supabase.auth.onAuthStateChange(() => {
      void getCurrentAdminStatus()
        .then((r) => setIsAdmin(r.isAdmin))
        .catch(() => setIsAdmin(false));
    });
    return () => {
      mounted = false;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!proMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (proMenuRef.current && !proMenuRef.current.contains(e.target as Node)) {
        setProMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [proMenuOpen]);

  const firstName = storedUser.fullName?.trim().split(/\s+/)[0] ?? "";

  const switchMode = (next: Mode) => {
    setMode(next);
    setLoginError(null);
    setResetInfo(null);
  };

  const scrollToPro = () => {
    proRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

      const fullName =
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        storedUser.fullName ??
        "";

      let plan = storedUser.plan ?? "free";
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("plan")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.plan) plan = profile.plan as string;
      } catch {
        // table profiles absente ou inaccessible
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

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setLoginError("Veuillez renseigner votre adresse email.");
      return;
    }

    setLoginLoading(true);
    setLoginError(null);
    setResetInfo(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        setLoginError("Impossible d'envoyer l'email pour le moment. Veuillez réessayer.");
      } else {
        setResetInfo(
          "Si un compte existe pour cette adresse, un email de réinitialisation vient d'être envoyé."
        );
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (mode === "login") {
        void handleLogin();
      } else {
        void handleResetPassword();
      }
    }
  };

  const handleExpressAnalysis = () => {
    // Filet autofill : Chrome peut remplir le DOM sans declencher onChange.
    // On lit la valeur reelle de l'input, l'etat React ne sert que de repli.
    const readField = (id: string, fallback: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      return (el?.value ?? "").trim() || fallback.trim();
    };

    const address = readField("express-address", expressAddress);
    const city = readField("express-city", expressCity);
    const postalCode = readField("express-cp", expressPostalCode);
    const surfaceRaw = readField("express-surface", expressSurface);
    const priceRaw = readField("express-price", expressPrice);

    const surface = Number(surfaceRaw);
    const price = Number(priceRaw);

    if (!address) {
      setExpressError("Veuillez renseigner l'adresse du bien.");
      return;
    }
    if (!city) {
      setExpressError("Veuillez renseigner la ville.");
      return;
    }
    if (!/^\d{5}$/.test(postalCode)) {
      setExpressError("Veuillez renseigner un code postal valide (5 chiffres).");
      return;
    }
    if (!surfaceRaw || !Number.isFinite(surface) || surface <= 0) {
      setExpressError("Veuillez renseigner une surface valide (en m²).");
      return;
    }
    if (!priceRaw || !Number.isFinite(price) || price <= 0) {
      setExpressError("Veuillez renseigner un prix demandé valide (en €).");
      return;
    }
    if (!expressPropertyType) {
      setExpressError("Veuillez sélectionner le type de bien.");
      return;
    }

    setExpressError(null);

    navigate("/analyse-rapide", {
      state: {
        prefill: {
          address,
          city,
          postalCode,
          surface: String(surface),
          askingPrice: String(price),
          propertyType: expressPropertyType,
        },
      },
    });
  };

  const handleExpressKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleExpressAnalysis();
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center">
            <img
              src={mimmozaLogo}
              alt="Mimmoza"
              className="h-10 w-auto object-contain"
              draggable={false}
            />
          </Link>

          <nav aria-label="Navigation principale" className="hidden items-center gap-1 lg:flex">
            <Link
              to="/"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              Accueil
            </Link>

            <Link
              to="/connexion"
              aria-current="page"
              className="rounded-lg px-3 py-2 text-sm font-medium text-sky-600"
            >
              Analyse Express
            </Link>

            <div ref={proMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setProMenuOpen((o) => !o)}
                aria-expanded={proMenuOpen}
                aria-haspopup="true"
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                Professionnels
                <ChevronDown
                  className={
                    proMenuOpen
                      ? "h-3.5 w-3.5 rotate-180 transition-transform"
                      : "h-3.5 w-3.5 transition-transform"
                  }
                  aria-hidden="true"
                />
              </button>

              {proMenuOpen ? (
                <div className="absolute left-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white py-2 shadow-lg shadow-slate-900/5">
                  {PRO_MENU.map((entry) => (
                    <Link
                      key={entry.to}
                      to={entry.to}
                      onClick={() => setProMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      {entry.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            <Link
              to="/api"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              API
            </Link>
            <Link
              to="/tarifs"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              Tarifs
            </Link>
            <Link
              to="/a-propos"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              À propos
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            {isAdmin ? (
              <button
                type="button"
                onClick={() => navigate("/admin")}
                title="Admin"
                className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 md:inline-flex"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                <span>Admin</span>
              </button>
            ) : null}

            <a
              href="mailto:support@mimmoza.com"
              aria-label="Contacter le support"
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 sm:inline-flex"
            >
              <CircleHelp className="h-4 w-4" aria-hidden="true" />
            </a>

            <button
              type="button"
              onClick={scrollToPro}
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              Se connecter Pro
            </button>
          </div>
        </div>
      </header>

      {/* ZONE PRINCIPALE */}
      <main className="relative flex-1">
        {/* Fond d'écran global */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 bg-[length:100%_100%] bg-no-repeat"
          style={{
            backgroundImage: "url('/illustrations/Fond_ecran_blanc_violet.png')",
            left: "4%",
            right: "0%",
          }}
        />

        <div className="relative grid h-full grid-cols-1 lg:grid-cols-2">
        {/* PARTIE EXPRESS */}
        <section
          aria-labelledby="express-title"
          className="relative overflow-hidden bg-gradient-to-br from-white/70 via-white/50 to-transparent px-5 py-12 sm:px-8 lg:px-12 lg:py-16"
        >

          <div className="relative mx-auto flex w-full max-w-xl flex-col">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-200/80 bg-white/70 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-sky-700 shadow-sm">
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              Pour particuliers
            </div>

            <h1
              id="express-title"
              className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl"
            >
              Achetez votre prochain bien
              <br />
              <span className="bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
                en toute confiance.
              </span>
            </h1>

            <p className="mt-5 max-w-lg text-base leading-7 text-slate-600">
              Analysez un appartement ou une maison en moins de 2 minutes.
              <br className="hidden sm:block" /> Sans compte. Paiement sécurisé.
            </p>

            <ul className="mt-7 space-y-3">
              {EXPRESS_BENEFITS.map((item) => (
                <li key={item.label} className="flex items-center gap-3 text-sm text-slate-700">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-white text-sky-600 shadow-sm">
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>

            <div className="mt-9 rounded-3xl border border-white/80 bg-white/80 p-5 shadow-[0_10px_40px_rgba(59,130,246,0.12)] backdrop-blur-sm sm:p-7">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Sparkles className="h-5 w-5 text-sky-600" aria-hidden="true" />
                Lancez votre analyse express
              </h2>

              <div className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="express-address"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    Adresse
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition-all focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <input
                      id="express-address"
                      type="text"
                      name="mimmoza-address"
                      autoComplete="off"
                      placeholder="12 rue de Rivoli"
                      value={expressAddress}
                      onChange={(e) => setExpressAddress(e.target.value)}
                      onKeyDown={handleExpressKeyDown}
                      className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="express-city"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Ville
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition-all focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
                      <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <input
                        id="express-city"
                        type="text"
                        name="mimmoza-city"
                        autoComplete="off"
                        placeholder="Paris"
                        value={expressCity}
                        onChange={(e) => setExpressCity(e.target.value)}
                        onKeyDown={handleExpressKeyDown}
                        className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="express-cp"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Code postal
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition-all focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
                      <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <input
                        id="express-cp"
                        type="text"
                        name="mimmoza-cp"
                        autoComplete="off"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="75004"
                        value={expressPostalCode}
                        onChange={(e) => setExpressPostalCode(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={handleExpressKeyDown}
                        className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="express-surface"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Surface (m²)
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition-all focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
                      <Ruler className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <input
                        id="express-surface"
                        type="number"
                        name="mimmoza-surface"
                        autoComplete="off"
                        min={1}
                        inputMode="numeric"
                        placeholder="72"
                        value={expressSurface}
                        onChange={(e) => setExpressSurface(e.target.value)}
                        onKeyDown={handleExpressKeyDown}
                        className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="express-price"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Prix demandé (€)
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition-all focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
                      <Euro className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <input
                        id="express-price"
                        type="number"
                        name="mimmoza-price"
                        autoComplete="off"
                        min={1}
                        inputMode="numeric"
                        placeholder="450000"
                        value={expressPrice}
                        onChange={(e) => setExpressPrice(e.target.value)}
                        onKeyDown={handleExpressKeyDown}
                        className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="express-type"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    Type de bien
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition-all focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
                    <Home className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <select
                      id="express-type"
                      value={expressPropertyType}
                      onChange={(e) => setExpressPropertyType(e.target.value as PropertyType)}
                      className="w-full cursor-pointer border-0 bg-transparent p-0 text-sm text-slate-900 outline-none"
                    >
                      <option value="">Maison ou appartement</option>
                      <option value="appartement">Appartement</option>
                      <option value="maison">Maison</option>
                    </select>
                  </div>
                </div>

                {expressError ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                  >
                    {expressError}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleExpressAnalysis}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-md shadow-sky-200/70 transition-all hover:from-sky-500 hover:to-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
                >
                  <span>Analyser ce bien &mdash; 4,90 &euro;</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>

                <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Paiement sécurisé par</span>
                  <span className="font-semibold italic tracking-tight text-indigo-600">
                    Stripe
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
              <Clock3 className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
              Rapport disponible immédiatement après paiement
            </div>
          </div>
        </section>

        {/* PARTIE PRO */}
        <section
          ref={proRef}
          aria-labelledby="pro-title"
          className="relative scroll-mt-16 overflow-hidden px-5 py-12 sm:px-8 lg:px-12 lg:py-16"
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[#071126]/70 via-[#0b1738]/55 to-[#1b1042]/60" />
          </div>

          <div className="relative mx-auto flex w-full max-w-xl flex-col">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-violet-300">
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              Pour les professionnels
            </div>

            <h2
              id="pro-title"
              className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl"
            >
              Développez vos opérations
              <br />
              <span className="text-violet-400">immobilières.</span>
            </h2>

            <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
              Une plateforme complète pour investisseurs, promoteurs,
              <br className="hidden sm:block" /> marchands de biens et financeurs.
            </p>

            <ul className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {PRO_BENEFITS.map((item) => (
                <li key={item.label} className="flex items-center gap-3 text-sm text-slate-300">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10 text-violet-300">
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>

            <div className="mt-9 rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:p-7">
              <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-violet-300">
                {mode === "login" ? (
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {mode === "login" ? "Connexion" : "Réinitialisation"}
              </div>

              <h3 className="mt-4 text-xl font-semibold text-white sm:text-2xl">
                {mode === "reset" ? (
                  "Mot de passe oublié ?"
                ) : firstName ? (
                  <>
                    Connexion à votre espace Pro,{" "}
                    <span className="text-violet-400">{firstName}</span>
                  </>
                ) : (
                  "Connexion à votre espace Pro"
                )}
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                {mode === "login"
                  ? "Connectez-vous pour accéder à votre compte Mimmoza."
                  : "Indiquez votre email : nous vous enverrons un lien pour créer un nouveau mot de passe."}
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="pro-email"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Email
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 transition-all focus-within:border-violet-400/50 focus-within:ring-4 focus-within:ring-violet-500/10">
                    <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <input
                      id="pro-email"
                      type="email"
                      autoComplete="email"
                      placeholder="nom@exemple.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="w-full border-0 bg-transparent p-0 text-sm text-white outline-none placeholder:text-slate-500"
                    />
                  </div>
                </div>

                {mode === "login" ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label htmlFor="pro-password" className="text-sm font-medium text-slate-200">
                        Mot de passe
                      </label>
                      <button
                        type="button"
                        onClick={() => switchMode("reset")}
                        className="rounded text-sm font-medium text-violet-300 transition hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                      >
                        Mot de passe oublié ?
                      </button>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 transition-all focus-within:border-violet-400/50 focus-within:ring-4 focus-within:ring-violet-500/10">
                      <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />

                      <input
                        id="pro-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Votre mot de passe"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full border-0 bg-transparent p-0 text-sm text-white outline-none placeholder:text-slate-500"
                      />

                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                        aria-label={
                          showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"
                        }
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}

                {loginError ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
                  >
                    {loginError}
                  </div>
                ) : null}

                {resetInfo ? (
                  <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    {resetInfo}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={mode === "login" ? handleLogin : handleResetPassword}
                  disabled={loginLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 transition-all hover:from-violet-500 hover:to-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071126] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>
                    {loginLoading
                      ? "Un instant..."
                      : mode === "login"
                      ? "Se connecter"
                      : "Envoyer le lien de réinitialisation"}
                  </span>
                  {loginLoading ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>

              {mode === "login" ? (
                <div className="mt-5 text-sm text-slate-400">
                  Pas encore de compte ?{" "}
                  <Link
                    to="/inscription"
                    className="font-medium text-violet-300 transition hover:text-violet-200"
                  >
                    Créer un compte Pro
                  </Link>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="mt-5 rounded text-sm font-medium text-violet-300 transition hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  &larr; Retour à la connexion
                </button>
              )}

              <div className="mt-4 text-xs text-slate-500">
                Email oublié ?{" "}
                 <a
                  href="mailto:support@mimmoza.com"
                  className="text-slate-400 transition hover:text-slate-200"
                >
                  Contactez le support
                </a>
              </div>
            </div>
          </div>
        </section>
        </div>
      </main>

      {/* BANDEAU DE REASSURANCE */}
      <section aria-label="Réassurance" className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col items-start justify-center gap-8 px-5 py-10 sm:flex-row sm:items-center sm:gap-16 sm:px-6 lg:px-8">
          {TRUST_ITEMS.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-600">
                <item.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{item.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER LEGAL */}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-5 py-5 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <p>&copy; {new Date().getFullYear()} Mimmoza. Tous droits réservés.</p>
          <nav aria-label="Liens légaux" className="flex flex-wrap justify-center gap-x-4 gap-y-2">
            <Link to="/mentions-legales" className="transition-colors hover:text-slate-900">
              Mentions légales
            </Link>
            <Link to="/cgu" className="transition-colors hover:text-slate-900">
              CGU
            </Link>
            <Link to="/cgv" className="transition-colors hover:text-slate-900">
              CGV
            </Link>
            <Link to="/politique-confidentialite" className="transition-colors hover:text-slate-900">
              Confidentialité
            </Link>
            <a href="mailto:support@mimmoza.com" className="transition-colors hover:text-slate-900">
              support@mimmoza.com
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}