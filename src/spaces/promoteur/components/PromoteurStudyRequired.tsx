// src/spaces/promoteur/components/PromoteurStudyRequired.tsx
//
// Guard React Router (layout <Outlet/>) — SOURCE DE VÉRITÉ de l'accès promoteur.
//   1. Résout le studyId (URL prioritaire, fallback active_study_id).
//   2. Teste isProjectUnlocked (Modèle A : 1 jeton = 1 étude).
//      - déverrouillé  -> <Outlet/>
//      - verrouillé/expiré -> même ProjectUnlockModal qu'AppShell (réouverture
//        EXPLICITE, 1 jeton) — jamais de re-paiement silencieux.
//      - aucune étude  -> écran "Aucune étude active".
//
// ⚠️ COHÉRENCE : les routes placées SOUS ce guard dans src/App.tsx doivent
//    correspondre EXACTEMENT aux routes NON listées dans
//    paywallConfig.freeRoutePrefixes. Toucher l'un = toucher l'autre.
//
// Usage dans App.tsx :
//   <Route element={<PromoteurStudyRequired />}>
//     <Route path="foncier" element={<FoncierPluPage />} />
//     ...
//   </Route>

import React, { useEffect, useState } from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { getActiveStudyId } from "../shared/promoteurSnapshot.store";
import { usePromoteurProgramSync } from "../shared/hooks/usePromoteurProgramSync";
import { ProjectUnlockModal } from "@/components/billing/ProjectUnlockModal";
import { isProjectUnlocked, unlockProject } from "@/lib/billing/projectUnlock";
import { getSpacePaywallConfig } from "@/lib/billing/paywallConfig";
import { supabase } from "@/lib/supabase";

const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";

// ── Cache des études déverrouillées CETTE session ────────────────────────────
// Évite de rejouer isProjectUnlocked à chaque (re)montage / navigation. Comme un
// Set au niveau module survivrait à un changement de compte, on le PURGE à chaque
// connexion/déconnexion (la RLS protège la base, pas l'UI).
// NB expiration : avec validityDays=30, une étude peut expirer pendant une session
// très longue — cache hit indéfini jusqu'au prochain SIGNED_IN/OUT. Cas marginal,
// accepté (le durcissement réel est serveur).
const unlockedStudyCache = new Set<string>();
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" || event === "SIGNED_IN") unlockedStudyCache.clear();
});

export default function PromoteurStudyRequired(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // URL prioritaire, fallback active_study_id.
  const studyId = searchParams.get("study") ?? getActiveStudyId();

  // Synchro Programmation → bâtiments 2D (vivante dès qu'on est dans une étude,
  // quelle que soit la sous-page active). Hook inconditionnel (règles des hooks) ;
  // no-op si studyId absent.
  usePromoteurProgramSync(studyId);

  // Résultat du contrôle async, tagué par studyId (évite tout flash de contenu
  // premium quand on passe d'une étude à une autre non encore vérifiée).
  const [asyncCheck, setAsyncCheck] = useState<{ studyId: string; unlocked: boolean } | null>(null);

  // État de la réouverture (modale).
  const [reopening, setReopening] = useState(false);
  const [noTokens, setNoTokens] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  useEffect(() => {
    if (!studyId) return;
    if (unlockedStudyCache.has(studyId)) {
      setAsyncCheck({ studyId, unlocked: true });
      return;
    }
    let alive = true;
    const days = getSpacePaywallConfig("promoteur").validityDays;
    isProjectUnlocked("promoteur", studyId, days)
      .then((ok) => {
        if (!alive) return;
        if (ok) unlockedStudyCache.add(studyId);
        setAsyncCheck({ studyId, unlocked: ok });
      })
      .catch(() => {
        if (alive) setAsyncCheck({ studyId, unlocked: false }); // fail-closed
      });
    return () => { alive = false; };
  }, [studyId]);

  async function handleReopen(): Promise<void> {
    if (!studyId) return;
    setReopening(true);
    setReopenError(null);
    setNoTokens(false);
    try {
      const days = getSpacePaywallConfig("promoteur").validityDays;
      const r = await unlockProject("promoteur", studyId, `Étude ${studyId.slice(0, 8)}…`, days);
      if (!r.ok) {
        if (r.reason === "NO_TOKENS") setNoTokens(true);
        else setReopenError(r.message);
        return;
      }
      unlockedStudyCache.add(studyId);
      setAsyncCheck({ studyId, unlocked: true });
    } catch {
      setReopenError("Réouverture impossible pour le moment.");
    } finally {
      setReopening(false);
    }
  }

  // ── Aucune étude ────────────────────────────────────────────────────────────
  if (!studyId) {
    return <CenteredMessage emoji="📋" title="Aucune étude active"
      text="Créez ou ouvrez une étude depuis le tableau de bord pour accéder à cette section."
      cta="← Retour au tableau de bord" onCta={() => navigate("/promoteur")} />;
  }

  const isChecked = unlockedStudyCache.has(studyId) || asyncCheck?.studyId === studyId;
  const isUnlocked = unlockedStudyCache.has(studyId) || (asyncCheck?.studyId === studyId && asyncCheck.unlocked);

  // ── Vérification en cours (pas de flash) ────────────────────────────────────
  if (!isChecked) {
    return <CenteredMessage emoji="⏳" title="Vérification de l'accès à l'étude…"
      text="Merci de patienter un instant." />;
  }

  // ── Verrouillée / expirée ───────────────────────────────────────────────────
  if (!isUnlocked) {
    return (
      <>
        <CenteredMessage emoji="🔒" title="Accès à l'étude expiré"
          text="Cette étude nécessite une réouverture pour retrouver l'accès à ses pages." />
        <ProjectUnlockModal
          open
          projectLabel={`Étude ${studyId.slice(0, 8)}…`}
          notice="Cette étude a expiré. Rouvrez-la pour 1 jeton afin de retrouver l'accès à toutes ses pages."
          features={getSpacePaywallConfig("promoteur").features}
          loading={reopening}
          noTokens={noTokens}
          errorMessage={reopenError}
          onClose={() => navigate("/promoteur")}
          onConfirmUnlock={handleReopen}
          onOpenBilling={() => navigate("/compte")}
          onOpenSubscriptions={() => navigate("/compte?section=abonnements")}
          onOpenTokens={() => navigate("/compte?section=jetons")}
        />
      </>
    );
  }

  // ── Déverrouillée ───────────────────────────────────────────────────────────
  return <Outlet />;
}

// ── Écran centré générique (styles inline, cohérent avec l'existant) ──────────
function CenteredMessage({
  emoji, title, text, cta, onCta,
}: {
  emoji: string;
  title: string;
  text: string;
  cta?: string;
  onCta?: () => void;
}): React.ReactElement {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "60vh", gap: 28, padding: "40px 24px",
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 22, background: GRAD_PRO,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 32, boxShadow: "0 8px 24px rgba(124,111,205,0.25)",
      }}>
        {emoji}
      </div>
      <div style={{ textAlign: "center", maxWidth: 380 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#2a1f6e", marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: "#8a7ec8", lineHeight: 1.6 }}>{text}</div>
      </div>
      {cta && onCta && (
        <button onClick={onCta} style={{
          padding: "11px 24px", borderRadius: 11, border: "none", background: GRAD_PRO,
          color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer",
          boxShadow: "0 4px 12px rgba(124,111,205,0.3)",
        }}>
          {cta}
        </button>
      )}
    </div>
  );
}
