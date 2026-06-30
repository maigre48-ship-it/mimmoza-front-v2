// src/spaces/promoteur/pages/NouvelleOpportunitePage.tsx

import {
  getApporteurDeal,
  updateApporteurDeal,
  type ApporteurDeal,
} from "@/spaces/apporteur/shared/apporteurDeals.store";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  HeroGhostButton,
  HeroPrimaryButton,
  PromoteurPageHero,
} from "../shared/components/PromoteurPageHero";
import { ACCENT_PRO, GRAD_PRO } from "../shared/promoteurDesign.tokens";
import { userStorage } from "@/lib/storage/userScopedStorage";

// ---------------------------------------------------------------------------
// Helpers promoteur
// ---------------------------------------------------------------------------

const PROMOTEUR_STUDIES_KEY  = "mimmoza.promoteur.studies.v1";
const PROMOTEUR_ACTIVE_KEY   = "mimmoza.promoteur.active_study_id";
const PROMOTEUR_SESSION_KEYS = [
  "mimmoza.promoteur.quick.address",
  "mimmoza.promoteur.quick.commune",
  "mimmoza.promoteur.quick.surface",
  "mimmoza.promoteur.foncier.draft",
  "mimmoza.promoteur.plu.draft",
];

function generateStudyId(): string {
  return "study_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function createPromoteurStudy(title: string): { id: string; title: string } {
  const id  = generateStudyId();
  const now = new Date().toISOString();
  try {
    const raw     = userStorage.getItem(PROMOTEUR_STUDIES_KEY);
    const studies = raw ? (JSON.parse(raw) as object[]) : [];
    studies.unshift({ id, title, createdAt: now, updatedAt: now });
    userStorage.setItem(PROMOTEUR_STUDIES_KEY, JSON.stringify(studies));
  } catch { /* noop */ }
  return { id, title };
}

function setActiveStudyId(id: string): void {
  try { userStorage.setItem(PROMOTEUR_ACTIVE_KEY, id); } catch { /* noop */ }
}

function clearPromoteurSessionKeys(): void {
  for (const key of PROMOTEUR_SESSION_KEYS) {
    try { userStorage.removeItem(key); } catch { /* noop */ }
  }
}

/** Extrait le code postal (5 chiffres) d'une adresse ou d'une commune. */
function extractPostalCode(adresse: string, commune: string): string | null {
  const RE = /\b(\d{5})\b/;
  return (RE.exec(adresse) ?? RE.exec(commune))?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TypeBien = ApporteurDeal["typeBien"];

interface FormState {
  titre:          string;
  adresse:        string;
  commune:        string;
  surface:        string;
  prixVendeur:    string;
  typeBien:       TypeBien;
  apporteurName:  string;
  apporteurEmail: string;
  apporteurPhone: string;
  commentaire:    string;
}

const TYPE_BIEN_OPTIONS: { value: TypeBien; label: string }[] = [
  { value: "terrain",  label: "Terrain nu" },
  { value: "maison",   label: "Maison" },
  { value: "immeuble", label: "Immeuble" },
  { value: "autre",    label: "Autre" },
];

// ---------------------------------------------------------------------------
// ── PAYWALL FLAG ────────────────────────────────────────────────────────────
const IS_UNLOCKED_DEFAULT = false;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NouvelleOpportunitePage() {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const dealId         = searchParams.get("dealId");

  const [isUnlocked, setIsUnlocked] = useState<boolean>(IS_UNLOCKED_DEFAULT);

  const [sourceDeal, setSourceDeal] = useState<ApporteurDeal | null | undefined>(undefined);
  const prefillDone = useRef(false);

  const [form, setForm] = useState<FormState>({
    titre:          "",
    adresse:        "",
    commune:        "",
    surface:        "",
    prixVendeur:    "",
    typeBien:       "terrain",
    apporteurName:  "",
    apporteurEmail: "",
    apporteurPhone: "",
    commentaire:    "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    if (prefillDone.current) return;
    prefillDone.current = true;

    if (!dealId) { setSourceDeal(null); return; }
    const deal = getApporteurDeal(dealId);
    if (!deal)  { setSourceDeal(null); return; }

    setSourceDeal(deal);
    setForm((prev) => ({
      ...prev,
      titre:          `Deal apporteur — ${deal.adresse}`,
      adresse:        deal.adresse             || prev.adresse,
      commune:        deal.commune             || prev.commune,
      surface:        deal.surfaceTerrainM2 != null ? String(deal.surfaceTerrainM2) : prev.surface,
      prixVendeur:    deal.prixVendeur      != null ? String(deal.prixVendeur)       : prev.prixVendeur,
      typeBien:       deal.typeBien            || prev.typeBien,
      apporteurName:  deal.apporteurName       || prev.apporteurName,
      apporteurEmail: deal.apporteurEmail      || prev.apporteurEmail,
      apporteurPhone: deal.apporteurPhone      || prev.apporteurPhone,
      commentaire:    deal.commentaire         || prev.commentaire,
    }));
  }, [dealId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleUnlock() {
    setIsUnlocked(true);
  }

  function handleSubmit() {
    if (!isUnlocked) { handleUnlock(); return; }

    if (!form.adresse.trim()) {
      setError("L'adresse est obligatoire.");
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const titre = form.titre.trim() || `Étude — ${form.adresse}`;

      const study = createPromoteurStudy(titre);
      setActiveStudyId(study.id);
      clearPromoteurSessionKeys();

    userStorage.setItem("mimmoza.promoteur.quick.address", form.adresse);
    userStorage.setItem("mimmoza.promoteur.quick.commune", form.commune);
    userStorage.setItem("mimmoza.promoteur.quick.surface", form.surface);

      if (sourceDeal) {
        updateApporteurDeal(sourceDeal.id, {
          status:           "qualifie",
          promoteurStudyId: study.id,
        });
      }

      navigate(`/promoteur/foncier?study=${study.id}`);
    } catch (err) {
      console.error("[NouvelleOpportunitePage] Erreur création étude:", err);
      setError("Une erreur est survenue. Veuillez réessayer.");
      setSubmitting(false);
    }
  }

  if (sourceDeal === undefined) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: "16px 0 0" }}>
          <PromoteurPageHero
            badge="Promoteur · Opportunités"
            title="Nouvelle opportunité"
            metaLines={[{ text: "Chargement…" }]}
          />
        </div>
      </div>
    );
  }

  const dealIntrouvable = dealId && sourceDeal === null;
  const postalCode = extractPostalCode(form.adresse, form.commune);

  return (
    <div style={pageStyle}>

      {/* ── Hero v2 — design VeilleMarchePage ── */}
      <div style={{ marginBottom: 24 }}>
        <PromoteurPageHero
          badge="Promoteur · Opportunités"
          title="Nouvelle opportunité"
          metaLines={[{
            text: isUnlocked
              ? "Créez une étude promoteur et lancez la qualification foncière."
              : "Débloquez cette opportunité pour accéder à toutes les informations et lancer l'étude.",
          }]}
          actions={
            <>
              <HeroGhostButton onClick={() => navigate(-1)}>← Retour</HeroGhostButton>
              {isUnlocked ? (
                <HeroPrimaryButton onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Création…" : "Créer l'étude et qualifier →"}
                </HeroPrimaryButton>
              ) : (
                <HeroPrimaryButton onClick={handleUnlock}>
                  🔓 Débloquer l'opportunité
                </HeroPrimaryButton>
              )}
            </>
          }
        />
      </div>

      {/* Bannière deal introuvable */}
      {dealIntrouvable && (
        <div style={bannerWarnStyle}>
          ⚠️ Deal apporteur introuvable — création manuelle.
        </div>
      )}

      {/* Bannière apporteur */}
      {sourceDeal && (
        <div style={bannerApporteurStyle}>
          <span style={{ fontSize: 20 }}>🤝</span>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#5B21B6" }}>
              Opportunité issue d'un apporteur d'affaires
            </p>
            {isUnlocked && sourceDeal.apporteurName && (
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#7C3AED" }}>
                {sourceDeal.apporteurName}
                {sourceDeal.apporteurEmail && ` · ${sourceDeal.apporteurEmail}`}
                {sourceDeal.apporteurPhone && ` · ${sourceDeal.apporteurPhone}`}
              </p>
            )}
            {!isUnlocked && (
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#7C3AED" }}>
                Identité de l'apporteur masquée — débloquée après validation.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Badge paywall si verrouillé */}
      {!isUnlocked && (
        <div style={paywallBadgeStyle}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#92400E" }}>
              Opportunité verrouillée
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#B45309" }}>
              Seules les données de cadrage sont visibles. Débloquez pour accéder à l'adresse complète,
              aux commentaires et aux coordonnées de l'apporteur.
            </p>
          </div>
        </div>
      )}

      {/* ── Carte formulaire ── */}
      <div style={cardStyle}>

        {isUnlocked && (
          <Field label="Titre de l'étude" required>
            <input
              style={inputStyle}
              value={form.titre}
              onChange={(e) => set("titre", e.target.value)}
              placeholder="Ex : Terrain Rue de la Paix, Paris 2e"
            />
          </Field>
        )}

        <Divider label="Bien" />

        {isUnlocked ? (
          <div style={rowStyle}>
            <Field label="Adresse" required style={{ flex: 2 }}>
              <input
                style={inputStyle}
                value={form.adresse}
                onChange={(e) => set("adresse", e.target.value)}
                placeholder="12 rue de la Paix"
              />
            </Field>
            <Field label="Commune" style={{ flex: 1 }}>
              <input
                style={inputStyle}
                value={form.commune}
                onChange={(e) => set("commune", e.target.value)}
                placeholder="Paris"
              />
            </Field>
          </div>
        ) : (
          <div style={rowStyle}>
            <Field label="Code postal" style={{ flex: 1 }}>
              <input
                style={{ ...inputStyle, background: "#F0FDF4", color: "#065F46", fontWeight: 700 }}
                value={postalCode ?? "—"}
                readOnly
              />
            </Field>
            <Field label="Adresse complète" style={{ flex: 2 }}>
              <div style={blurFieldStyle}>
                <span style={blurTextStyle}>12 rue de la Paix, Paris</span>
                <span style={blurBadgeStyle}>🔒 Verrouillée</span>
              </div>
            </Field>
          </div>
        )}

        <div style={rowStyle}>
          <Field label="Type de bien" style={{ flex: 1 }}>
            {isUnlocked ? (
              <select
                style={inputStyle}
                value={form.typeBien}
                onChange={(e) => set("typeBien", e.target.value as TypeBien)}
              >
                {TYPE_BIEN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                style={{ ...inputStyle, background: "#F0FDF4", color: "#065F46", fontWeight: 600 }}
                value={TYPE_BIEN_OPTIONS.find((o) => o.value === form.typeBien)?.label ?? "—"}
                readOnly
              />
            )}
          </Field>
          <Field label="Surface terrain (m²)" style={{ flex: 1 }}>
            <input
              style={{ ...inputStyle, background: "#F0FDF4", color: "#065F46", fontWeight: 700 }}
              type={isUnlocked ? "number" : "text"}
              min={0}
              value={form.surface || "—"}
              onChange={isUnlocked ? (e) => set("surface", e.target.value) : undefined}
              readOnly={!isUnlocked}
            />
          </Field>
          <Field label="Prix vendeur (€)" style={{ flex: 1 }}>
            <input
              style={{ ...inputStyle, background: "#F0FDF4", color: "#065F46", fontWeight: 700 }}
              type={isUnlocked ? "number" : "text"}
              min={0}
              value={form.prixVendeur ? (isUnlocked ? form.prixVendeur : Number(form.prixVendeur).toLocaleString("fr-FR") + " €") : "—"}
              onChange={isUnlocked ? (e) => set("prixVendeur", e.target.value) : undefined}
              readOnly={!isUnlocked}
            />
          </Field>
        </div>

        <Field label="Commentaire / contexte">
          {isUnlocked ? (
            <textarea
              style={{ ...inputStyle, minHeight: 72, resize: "vertical" }}
              value={form.commentaire}
              onChange={(e) => set("commentaire", e.target.value)}
              placeholder="Informations complémentaires…"
            />
          ) : (
            <div style={blurBlockStyle}>
              <div style={blurOverlayStyle}>
                <span style={{ fontSize: 18, marginBottom: 4 }}>🔒</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#6D28D9" }}>
                  Information réservée aux promoteurs ayant débloqué l'opportunité.
                </span>
              </div>
              <div style={{ filter: "blur(5px)", userSelect: "none", fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Terrain idéalement situé, viabilisé,
                CU positif obtenu. Proche école, commerces, transport. Vendeur motivé, négociation possible.
              </div>
            </div>
          )}
        </Field>

        <Divider label="Apporteur" />

        <div style={{ position: "relative" }}>
          <div style={{ pointerEvents: isUnlocked ? "auto" : "none" }}>
            <div style={{ ...rowStyle, filter: isUnlocked ? "none" : "blur(6px)", userSelect: isUnlocked ? "auto" : "none" }}>
              <Field label="Nom apporteur" style={{ flex: 1 }}>
                <input
                  style={inputStyle}
                  value={form.apporteurName}
                  onChange={(e) => set("apporteurName", e.target.value)}
                  placeholder="Jean Dupont"
                  tabIndex={isUnlocked ? 0 : -1}
                />
              </Field>
              <Field label="Email" style={{ flex: 1 }}>
                <input
                  style={inputStyle}
                  type="email"
                  value={form.apporteurEmail}
                  onChange={(e) => set("apporteurEmail", e.target.value)}
                  placeholder="jean@exemple.fr"
                  tabIndex={isUnlocked ? 0 : -1}
                />
              </Field>
              <Field label="Téléphone" style={{ flex: 1 }}>
                <input
                  style={inputStyle}
                  type="tel"
                  value={form.apporteurPhone}
                  onChange={(e) => set("apporteurPhone", e.target.value)}
                  placeholder="06 00 00 00 00"
                  tabIndex={isUnlocked ? 0 : -1}
                />
              </Field>
            </div>
          </div>

          {!isUnlocked && (
            <div style={apporteurOverlayStyle}>
              <div style={apporteurOverlayInnerStyle}>
                <span style={{ fontSize: 22, marginBottom: 6 }}>🔒</span>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#5B21B6" }}>
                  Coordonnées de l'apporteur verrouillées
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#7C3AED" }}>
                  Débloquez cette opportunité pour accéder au contact complet.
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#B91C1C" }}>{error}</p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <button onClick={() => navigate(-1)} disabled={submitting} style={btnGhostStyle}>
            Annuler
          </button>
          {isUnlocked ? (
            <button onClick={handleSubmit} disabled={submitting} style={btnPrimaryStyle}>
              {submitting ? "Création…" : "Créer l'étude et qualifier →"}
            </button>
          ) : (
            <button onClick={handleUnlock} style={btnUnlockStyle}>
              🔓 Débloquer l'opportunité
            </button>
          )}
        </div>
      </div>

      {/* CTA paywall bas de page */}
      {!isUnlocked && (
        <div style={paywallCtaStyle}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#111827" }}>
              Accédez à l'intégralité de cette opportunité
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6B7280" }}>
              Adresse complète · Commentaires · Coordonnées apporteur · Lancement de l'étude
            </p>
          </div>
          <button onClick={handleUnlock} style={btnUnlockStyle}>
            🔓 Débloquer — voir le tarif
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Field({
  label, required, children, style,
}: {
  label:     string;
  required?: boolean;
  children:  React.ReactNode;
  style?:    React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}{required && <span style={{ color: "#6D28D9", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 16px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: "#F3F4F6" }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  padding: "24px 28px 40px", maxWidth: 900, margin: "0 auto", fontFamily: "inherit",
};
const cardStyle: React.CSSProperties = {
  background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12,
  padding: "24px 24px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
  display: "flex", flexDirection: "column", gap: 14,
};
const rowStyle: React.CSSProperties = {
  display: "flex", gap: 14, flexWrap: "wrap",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 7,
  border: "1px solid #E5E7EB", fontSize: 14, color: "#111827",
  background: "#FAFAFA", boxSizing: "border-box",
  outline: "none", fontFamily: "inherit",
};

// ── Paywall UI ──────────────────────────────────────────────────────────────

const paywallBadgeStyle: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 10,
  background: "#FFFBEB", border: "1px solid #FDE68A",
  borderRadius: 8, padding: "10px 14px", marginBottom: 20,
};
const paywallCtaStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
  background: "#F5F3FF", border: "1px solid #DDD6FE",
  borderRadius: 12, padding: "16px 20px", marginTop: 20,
};
const blurFieldStyle: React.CSSProperties = {
  position: "relative", width: "100%", padding: "8px 10px", borderRadius: 7,
  border: "1px solid #E5E7EB", background: "#FAFAFA",
  display: "flex", alignItems: "center", justifyContent: "space-between",
  overflow: "hidden", boxSizing: "border-box",
};
const blurTextStyle: React.CSSProperties = {
  filter: "blur(5px)", userSelect: "none", fontSize: 14,
  color: "#111827", pointerEvents: "none",
};
const blurBadgeStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#6D28D9",
  background: "#EDE9FE", borderRadius: 4, padding: "2px 6px",
  whiteSpace: "nowrap", marginLeft: 6,
};
const blurBlockStyle: React.CSSProperties = {
  position: "relative", borderRadius: 7, border: "1px solid #E5E7EB",
  padding: "12px", overflow: "hidden", minHeight: 72,
  background: "#FAFAFA",
};
const blurOverlayStyle: React.CSSProperties = {
  position: "absolute", inset: 0, zIndex: 2,
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  gap: 4, background: "rgba(245,243,255,0.85)", backdropFilter: "blur(2px)",
  borderRadius: 7, padding: "8px 12px",
};
const apporteurOverlayStyle: React.CSSProperties = {
  position: "absolute", inset: 0, zIndex: 2,
  display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 8, background: "rgba(245,243,255,0.82)", backdropFilter: "blur(3px)",
};
const apporteurOverlayInnerStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center",
  textAlign: "center", padding: "12px 20px",
};

// ── Bannières ────────────────────────────────────────────────────────────────

const bannerApporteurStyle: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 10,
  background: "#F5F3FF", border: "1px solid #DDD6FE",
  borderRadius: 8, padding: "10px 14px", marginBottom: 20,
};
const bannerWarnStyle: React.CSSProperties = {
  background: "#FFF7ED", border: "1px solid #FED7AA",
  borderRadius: 8, padding: "10px 14px", marginBottom: 20,
  fontSize: 13, color: "#92400E",
};

// ── Boutons ─────────────────────────────────────────────────────────────────

const btnPrimaryStyle: React.CSSProperties = {
  background: ACCENT_PRO, color: "#fff", border: `1px solid ${ACCENT_PRO}`,
  padding: "9px 20px", borderRadius: 8, fontSize: 14,
  fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const btnGhostStyle: React.CSSProperties = {
  background: "#F9FAFB", color: "#374151", border: "1px solid #E5E7EB",
  padding: "9px 16px", borderRadius: 8, fontSize: 14,
  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const btnUnlockStyle: React.CSSProperties = {
  background: GRAD_PRO,
  color: "#fff", border: "none",
  padding: "10px 22px", borderRadius: 8, fontSize: 14,
  fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  boxShadow: "0 2px 8px rgba(109,40,217,0.30)",
  whiteSpace: "nowrap",
};