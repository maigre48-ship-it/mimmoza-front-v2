// src/components/BandeauCookies.tsx
//
// Bandeau d'INFORMATION sur les cookies (audit du 21/10/2026).
//
// La Plateforme n'utilise que des stockages techniques (session Supabase,
// préférences et travaux en localStorage) : aucun outil de mesure d'audience,
// aucun cookie publicitaire (vérifié : ni gtag, ni Matomo, ni Plausible, ni
// @vercel/analytics dans le dépôt). Ces stockages sont exemptés de
// consentement (art. 82 loi Informatique et Libertés) : un simple bandeau
// d'information suffit, conforme à l'article 12 des CGU et à l'article 8 de la
// politique de confidentialité.
//
// ⚠️ Si un outil d'audience ou un service tiers déposant des traceurs est
// ajouté un jour, ce bandeau devra devenir un vrai recueil de consentement
// (accepter / refuser / personnaliser) AVANT tout dépôt.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const CLE = "mimmoza.cookies.informe";
const DUREE_MS = 365 * 24 * 60 * 60 * 1000; // 12 mois

function dejaInforme(): boolean {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return false;
    const date = Number(brut);
    return Number.isFinite(date) && Date.now() - date < DUREE_MS;
  } catch {
    // Stockage indisponible : on n'affiche pas un bandeau impossible à fermer.
    return true;
  }
}

export function BandeauCookies() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!dejaInforme());
  }, []);

  if (!visible) return null;

  const fermer = () => {
    try { localStorage.setItem(CLE, String(Date.now())); } catch { /* noop */ }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Information sur les cookies"
      className="fixed inset-x-3 bottom-3 z-[1100] mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white/95 p-4 text-sm text-slate-700 shadow-lg backdrop-blur sm:inset-x-6 sm:flex sm:items-center sm:gap-4"
    >
      <p className="flex-1 leading-6">
        Mimmoza n'utilise <strong>ni cookie publicitaire ni mesure d'audience</strong>. Seuls des
        stockages techniques indispensables (connexion, préférences, travaux en cours) sont
        enregistrés dans votre navigateur.{" "}
        <Link to="/politique-confidentialite#art8" className="font-medium text-sky-700 underline">
          En savoir plus
        </Link>
      </p>
      <button
        type="button"
        onClick={fermer}
        className="mt-3 inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 sm:mt-0"
      >
        J'ai compris
      </button>
    </div>
  );
}

export default BandeauCookies;
