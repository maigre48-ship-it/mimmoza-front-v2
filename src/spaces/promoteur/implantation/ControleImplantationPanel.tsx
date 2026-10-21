// src/spaces/promoteur/implantation/ControleImplantationPanel.tsx
//
// LOT L1b — panneau « Contrôle d'implantation Mimmoza » (Implantation 2D).
// Tableau par bâtiment et par limite : catégorie, distance mesurée, retrait
// requis (source en infobulle), verdict. Jamais de « conforme » : au mieux
// « respecte les retraits sourcés connus ».
// LOT L2 : document source (intitulé, idurba, date et ancienneté), article,
// page et extrait de chaque valeur (dépliable / infobulle), et bouton
// « Valider avec la source » quand la référence est documentaire.

import React, { useState } from "react";
import type { CategorieLimite } from "./boundaryDistances";
import type { EtatControle } from "./useControleImplantation";
import { RAISON_LABELS, VERDICT_COLORS, VERDICT_LABELS, type NiveauImplantation, type Verdict } from "./implantationCheck";
import { CATEGORIES_REGLE, LIBELLES_CATEGORIE, PROVENANCE_NON_TRANSMISE, type CategorieRegle } from "./rulesetReculs";
import { MOTIF_NON_DOCUMENTAIRE_LABELS, extraitCourt, libelleSourceDocumentaire, type DocumentPlu, type ValeurProvenancePlu } from "../lib/pluProvenance";

const METHODE_LABELS: Readonly<Record<string, string>> = { regex: "lecture automatique (regex)", llm: "extraction IA", saisie: "saisie", cache: "cache" };
const MOTIF_PROVENANCE: Readonly<Record<string, string>> = {
  "article-introuvable": "article introuvable dans le document",
  "valeur-non-trouvee": "valeur non trouvée dans l'article",
  "regle-non-chiffree": "règle non chiffrée (H/2…)",
  "valeur-ia-non-retrouvee": "valeur IA non retrouvée dans le texte",
  "regle-divergente": "type de règle du texte différent de celui de l'IA",
};

/** Infobulle texte d'une provenance (article, page, méthode, confiance, extrait). */
export function infobulleProvenance(p: ValeurProvenancePlu | null | undefined, doc: DocumentPlu | null | undefined): string {
  if (!p) return "Aucune provenance pour cette valeur (ancien format ou valeur absente) : à vérifier.";
  const lignes = [
    `${libelleSourceDocumentaire(p, doc)}${p.articleIntitule ? ` — intitulé lu : « ${p.articleIntitule} »` : ""}${p.articleZone ? ` (zone ${p.articleZone})` : " (zone de l'article inconnue)"}`,
    `${METHODE_LABELS[p.methode] ?? p.methode}${p.confiance !== null ? ` · confiance ${Math.round(p.confiance * 100)} %` : ""}${p.motif ? ` · ${MOTIF_PROVENANCE[p.motif] ?? p.motif}` : ""}`,
  ];
  if (p.extrait) lignes.push(`« ${p.extrait} »`);
  return lignes.join("\n");
}

const ProvenanceDetail: React.FC<{ p: ValeurProvenancePlu | null | undefined; doc: DocumentPlu | null | undefined }> = ({ p, doc }) => {
  if (!p) return <div style={{ color: C.slate400, fontSize: 9.5 }}>Provenance non transmise : à vérifier.</div>;
  return (
    <div style={{ fontSize: 9.5, color: C.slate500, marginTop: 2 }}>
      <span title={infobulleProvenance(p, doc)}>
        Source : {libelleSourceDocumentaire(p, doc)} · {METHODE_LABELS[p.methode] ?? p.methode}
        {p.confiance !== null ? ` · confiance ${Math.round(p.confiance * 100)} %` : ""}
        {p.motif ? ` · ${MOTIF_PROVENANCE[p.motif] ?? p.motif}` : ""}
      </span>
      {p.extrait && (
        <details style={{ marginTop: 2 }}>
          <summary style={{ cursor: "pointer", color: C.slate700 }}>Extrait{p.article ? ` de l'art. ${p.article}` : ""}{p.page !== null ? `, p. ${p.page}` : ""}</summary>
          <blockquote style={{ margin: "3px 0 0", padding: "4px 6px", borderLeft: `2px solid ${C.slate200}`, background: C.slate100, color: C.slate700, fontStyle: "italic", whiteSpace: "pre-wrap" }}>« {p.extrait} »</blockquote>
        </details>
      )}
    </div>
  );
};

const SourceForm: React.FC<{ libelle: string; onValider: (par: string) => string | null }> = ({ libelle, onValider }) => {
  const [par, setPar] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 4, padding: 6, background: C.slate100, borderRadius: 6 }}>
      <div style={{ fontSize: 9.5, color: C.slate700, marginBottom: 3 }}>{libelle}</div>
      <div style={{ display: "flex", gap: 4 }}>
        <input style={input} value={par} onChange={(e) => setPar(e.target.value)} placeholder="Votre nom (prénom et nom)" aria-label="Nom de la personne qui valide" />
        <button type="button" style={{ ...btn, color: C.violet }} onClick={() => setErr(onValider(par))}>Valider</button>
      </div>
      {err && <div style={{ color: VERDICT_COLORS["non-respecte"], fontSize: 10, marginTop: 3 }}>{err}</div>}
      <div style={{ color: C.slate500, fontSize: 9.5, marginTop: 3 }}>
        Valider, c'est attester avoir relu l'extrait dans le document. La validation est perdue si la valeur, l'extrait, la page ou le document changent.
      </div>
    </div>
  );
};

const C = {
  slate900: "#0f172a", slate700: "#334155", slate500: "#64748b", slate400: "#94a3b8",
  slate200: "#e2e8f0", slate100: "#f1f5f9", white: "#ffffff", violet: "#4f46e5",
};
const NIVEAU_COLORS: Readonly<Record<NiveauImplantation, string>> = {
  "non-respecte": VERDICT_COLORS["non-respecte"],
  "a-verifier": VERDICT_COLORS["a-verifier"],
  "respecte-regles-sourcees-connues": VERDICT_COLORS.respecte,
  "non-evaluable": C.slate500,
};
const fmt = (v: number | null | undefined, unit = "m"): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(2).replace(".", ",")} ${unit}`;

const Badge: React.FC<{ verdict: Verdict; title?: string }> = ({ verdict, title }) => (
  <span title={title} style={{
    display: "inline-block", padding: "1px 6px", borderRadius: 6, fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap",
    color: VERDICT_COLORS[verdict], background: `${VERDICT_COLORS[verdict]}14`, border: `1px solid ${VERDICT_COLORS[verdict]}55`,
  }}>{VERDICT_LABELS[verdict]}</span>
);

const Titre: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 9, fontWeight: 700, color: C.slate500, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 5px" }}>{children}</div>
);

const btn: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.slate200}`, background: C.white,
  fontSize: 10.5, fontWeight: 600, color: C.slate700, cursor: "pointer",
};
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "3px 6px", borderRadius: 5, border: `1px solid ${C.slate200}`, fontSize: 10.5,
};

export interface AutresReglesIndicatives {
  readonly hauteurMaxMesureeM: number | null;
  readonly cesMesure: number | null;
  readonly placesFournies: number | null;
}

export interface ControleImplantationPanelProps {
  readonly etat: EtatControle;
  readonly onOuvrirFoncier: () => void;
  readonly reculsDessin: { readonly frontM: number; readonly sideM: number; readonly rearM: number };
  readonly onAppliquerAuDessin: (patch: Partial<{ frontM: number; sideM: number; rearM: number }>) => void;
  readonly autres: AutresReglesIndicatives;
}

const ValidationForm: React.FC<{ cat: CategorieRegle; suggestion: string; onValider: (ref: string, par: string) => string | null }> = ({ cat, suggestion, onValider }) => {
  // Champ vide : la personne saisit elle-même la référence (aucune référence pré-remplie ne vaut lecture du document).
  const [ref, setRef] = useState("");
  const [par, setPar] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 4, padding: 6, background: C.slate100, borderRadius: 6 }}>
      <input style={input} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={`Référence lue (ex. ${suggestion})`} aria-label={`Référence ${LIBELLES_CATEGORIE[cat]}`} />
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <input style={input} value={par} onChange={(e) => setPar(e.target.value)} placeholder="Votre nom" aria-label="Nom de la personne qui valide" />
        <button type="button" style={{ ...btn, color: C.violet }} onClick={() => setErr(onValider(ref, par))}>Valider</button>
      </div>
      {err && <div style={{ color: VERDICT_COLORS["non-respecte"], fontSize: 10, marginTop: 3 }}>{err}</div>}
      <div style={{ color: C.slate500, fontSize: 9.5, marginTop: 3 }}>
        Valider, c'est attester avoir lu la règle dans le document. La validation est perdue si la valeur, le document ou la zone changent.
      </div>
    </div>
  );
};

export const ControleImplantationPanel: React.FC<ControleImplantationPanelProps> = ({ etat, onOuvrirFoncier, reculsDessin, onAppliquerAuDessin, autres }) => {
  const { controle, segments, etatRuleset, validations } = etat;
  const [formOuvert, setFormOuvert] = useState<CategorieRegle | null>(null);
  const [formSource, setFormSource] = useState<CategorieRegle | null>(null);
  const doc = controle.document;
  const dateDoc = controle.etatDateDocument;
  const pv = (champ: string): ValeurProvenancePlu | null => controle.provenancePlu?.valeurs[champ] ?? null;
  const prov = controle.provenance;
  const rs = etatRuleset.statut === "ok" ? etatRuleset.ruleset : null;
  const val = (path: string[]): number | null => {
    let cur: unknown = rs;
    for (const k of path) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
    return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
  };
  const exterieurs = segments.filter((s) => !s.interne);
  const deduits = exterieurs.some((s) => s.origineClassement === "deduite");

  return (
    <div style={{ padding: "8px 14px 12px", fontFamily: "Inter,system-ui,sans-serif", color: C.slate900 }} data-testid="controle-implantation-mimmoza">
      {/* Niveau global */}
      <div style={{ padding: "8px 10px", borderRadius: 8, borderLeft: `3px solid ${NIVEAU_COLORS[controle.niveau]}`, background: `${NIVEAU_COLORS[controle.niveau]}10` }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: NIVEAU_COLORS[controle.niveau] }}>{controle.libelleNiveau}</div>
        <div style={{ fontSize: 10, color: C.slate500, marginTop: 2 }}>
          Retraits aux limites uniquement. Un verdict n'est donné qu'avec une règle sourcée et validée par une personne nommée.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.slate700, marginTop: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={etat.cotesVisibles} onChange={(e) => etat.setCotesVisibles(e.target.checked)} />
          Afficher les cotes colorées sur le plan
        </label>
      </div>

      {/* Règlement chargé */}
      <Titre>Règlement PLU chargé</Titre>
      {etatRuleset.statut !== "ok" ? (
        <div style={{ fontSize: 10.5, color: C.slate700, lineHeight: 1.5 }}>
          {etatRuleset.statut === "absent" ? RAISON_LABELS["ruleset-absent"] : etatRuleset.statut === "illisible" ? RAISON_LABELS["ruleset-illisible"] : RAISON_LABELS["ruleset-format-inconnu"]}.
          <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
            <button type="button" style={{ ...btn, color: C.violet }} onClick={onOuvrirFoncier}>Ouvrir Foncier / PLU</button>
            <button type="button" style={btn} onClick={etat.recharger}>Relire</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 10.5, color: C.slate700, lineHeight: 1.55 }}>
          <div>Zone <strong>{prov?.zoneCode ?? "inconnue"}</strong>{prov?.zoneLibelle ? ` — ${prov.zoneLibelle}` : ""} · commune {prov?.communeInsee ?? "non indiquée"}</div>
          <div>Document : {doc?.intitule ?? prov?.documentId ?? <em>non identifié</em>}{doc?.id ? <span style={{ color: C.slate400, fontFamily: "monospace", fontSize: 9 }}> · {doc.id}</span> : null}</div>
          {doc && (
            <div>
              Document opposable (GPU) : {doc.idurba ?? <em>non lu</em>}
              {doc.correspondanceGpu === "nom-fichier-identique" ? " · même fichier que le règlement publié" : doc.correspondanceGpu === "non-verifiee" ? " · correspondance avec le PDF importé non vérifiée" : doc.correspondanceGpu === "gpu-aucun-document" ? " · aucun document publié au GPU au point de la parcelle" : ""}
            </div>
          )}
          {dateDoc && (
            <div style={{ color: dateDoc.statut === "recente" ? C.slate700 : VERDICT_COLORS["a-verifier"], fontWeight: dateDoc.statut === "recente" ? 400 : 600 }}>
              {dateDoc.statut === "recente" ? "" : "⚠ "}{dateDoc.libelle}
            </div>
          )}
          <div>Source : {prov?.source ?? "non indiquée"} · confiance déclarée : {prov?.confiance === null || prov?.confiance === undefined ? "non indiquée" : `${Math.round(prov.confiance * 100)} %`}</div>
          {controle.provenancePlu ? (
            <div style={{ color: C.slate500 }}>Provenance par valeur : article, extrait, page et méthode d'extraction (dépliez « Extrait » sous chaque règle).</div>
          ) : (
            <div style={{ color: C.slate500 }}>Ancien format : non transmis par le règlement chargé : {PROVENANCE_NON_TRANSMISE.join(", ")}. Rechargez le PDF dans Foncier / PLU pour obtenir la provenance.</div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button type="button" style={btn} onClick={onOuvrirFoncier}>Modifier dans Foncier / PLU</button>
            <button type="button" style={btn} onClick={etat.recharger}>Relire</button>
          </div>
        </div>
      )}

      {/* Retraits du règlement */}
      {controle.regles && (
        <>
          <Titre>Retraits du règlement</Titre>
          {CATEGORIES_REGLE.map((cat) => {
            const r = controle.regles![cat];
            const v = validations[cat];
            const ok = r.motif === null;
            return (
              <div key={cat} style={{ padding: "5px 0", borderBottom: `1px solid ${C.slate100}`, fontSize: 10.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>{LIBELLES_CATEGORIE[cat]}</span>
                  <span title={r.regle.champ ? `Champ lu : ${r.regle.champ}${r.regle.note ? ` — ${r.regle.note}` : ""}` : "Absent du règlement chargé"}>
                    <strong>{fmt(r.regle.valeur)}</strong>
                  </span>
                </div>
                <div style={{ color: ok ? VERDICT_COLORS.respecte : VERDICT_COLORS["a-verifier"], fontSize: 10 }}>
                  {ok && v ? `Validée par ${v.par} le ${new Date(v.le).toLocaleDateString("fr-FR")} — ${v.reference}` : RAISON_LABELS[r.motif!]}
                </div>
                {r.regle.valeur !== null && (
                  <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                    {v && <button type="button" style={btn} onClick={() => etat.retirerValidation(cat)}>Retirer la validation</button>}
                    {!ok && (
                      <button type="button" style={btn} onClick={() => { setFormOuvert(formOuvert === cat ? null : cat); setFormSource(null); }}>
                        {formOuvert === cat ? "Fermer" : r.natureReference === "documentaire" ? "Saisir une autre référence" : "Valider cette règle"}
                      </button>
                    )}
                  </div>
                )}
                {r.regle.valeur !== null && <ProvenanceDetail p={r.regle.provenanceValeur} doc={doc} />}
                {r.regle.valeur !== null && r.regle.provenanceValeur && r.regle.motifNonDocumentaire && (
                  <div style={{ fontSize: 9.5, color: VERDICT_COLORS["a-verifier"], marginTop: 2 }}>
                    Source non proposée en un clic : {MOTIF_NON_DOCUMENTAIRE_LABELS[r.regle.motifNonDocumentaire]}. À vérifier (saisissez la référence lue).
                  </div>
                )}
                {!ok && r.regle.valeur !== null && r.natureReference === "documentaire" && r.regle.provenanceValeur && (
                  <button
                    type="button"
                    style={{ ...btn, marginTop: 3, color: C.violet, textAlign: "left", whiteSpace: "normal" }}
                    title={infobulleProvenance(r.regle.provenanceValeur, doc)}
                    onClick={() => { setFormSource(formSource === cat ? null : cat); setFormOuvert(null); }}
                  >
                    Valider avec la source : {libelleSourceDocumentaire(r.regle.provenanceValeur, doc)}, « {extraitCourt(r.regle.provenanceValeur, 60)} »
                  </button>
                )}
                {formSource === cat && !ok && r.regle.provenanceValeur && (
                  <SourceForm
                    libelle={`${libelleSourceDocumentaire(r.regle.provenanceValeur, doc)} — « ${extraitCourt(r.regle.provenanceValeur, 160)} »`}
                    onValider={(par) => {
                      const e = etat.validerAvecSource(cat, par);
                      if (!e) setFormSource(null);
                      return e;
                    }}
                  />
                )}
                {r.avertissements.map((a) => (
                  <div key={a} style={{ color: VERDICT_COLORS["non-respecte"], fontSize: 10, marginTop: 2 }}>⚠ {a}</div>
                ))}
                {formOuvert === cat && !ok && (
                  <ValidationForm
                    cat={cat}
                    suggestion={prov?.zoneCode ? `PLU zone ${prov.zoneCode}, art. 6` : "PLU, art. 6"}
                    onValider={(ref, par) => {
                      const e = etat.valider(cat, ref, par);
                      if (!e) setFormOuvert(null);
                      return e;
                    }}
                  />
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Classement des limites */}
      <Titre>Classement des limites</Titre>
      {etat.frontEdgeIndex === null && (
        <div style={{ fontSize: 10.5, color: C.slate700, marginBottom: 4 }}>
          Désignez la limite sur rue avec le bouton « 📍 Façade terrain » du plan, ou classez chaque limite ci-dessous.
        </div>
      )}
      <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${C.slate100}`, borderRadius: 6 }}>
        {exterieurs.filter((s, i, arr) => arr.findIndex((k) => k.baseId === s.baseId) === i).map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", fontSize: 10.5, borderBottom: `1px solid ${C.slate100}` }}>
            <span style={{ fontFamily: "monospace", color: C.slate500, minWidth: 44 }}>{s.baseId}</span>
            <span style={{ color: C.slate500, minWidth: 48 }}>{fmt(exterieurs.filter((k) => k.baseId === s.baseId).reduce((t, k) => t + k.length, 0))}</span>
            <select
              value={s.categorie}
              onChange={(e) => etat.choisirCategorie(s.baseId, e.target.value as CategorieLimite)}
              style={{ flex: 1, fontSize: 10.5, padding: "1px 3px", borderRadius: 4, border: `1px solid ${C.slate200}` }}
              aria-label={`Catégorie de la limite ${s.baseId}`}
            >
              {(["voirie", "separative", "fond", "non-classee"] as const).map((c) => <option key={c} value={c}>{LIBELLES_CATEGORIE[c]}</option>)}
            </select>
            <span style={{ fontSize: 9, color: s.origineClassement === "utilisateur" ? VERDICT_COLORS.respecte : C.slate400, minWidth: 44 }}>
              {s.origineClassement === "utilisateur" ? "confirmé" : s.origineClassement === "deduite" ? "déduit" : "—"}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
        {deduits && <button type="button" style={{ ...btn, color: C.violet }} onClick={etat.confirmerClassement}>Confirmer le classement proposé</button>}
        <button type="button" style={btn} onClick={etat.reinitialiserClassement}>Réinitialiser mes choix</button>
      </div>
      {(etat.nbPolygones > 1 || etat.trousIgnores > 0 || segments.some((s) => s.interne)) && (
        <div style={{ fontSize: 10, color: VERDICT_COLORS["a-verifier"], marginTop: 5, lineHeight: 1.45 }}>
          {etat.nbPolygones > 1 && `Parcelle en ${etat.nbPolygones} polygones : le plan n'affiche que le plus grand, le contrôle les mesure tous (limites p1-…, p2-… à classer). `}
          {segments.some((s) => s.interne) && `${segments.filter((s) => s.interne).length} portion(s) d'arête commune(s) entre polygones exclue(s) (limites internes, ${segments.filter((s) => s.interne).reduce((t, s) => t + s.length, 0).toFixed(2).replace(".", ",")} m) ; le reste de ces arêtes reste mesuré. `}
          {etat.trousIgnores > 0 && `${etat.trousIgnores} enclave(s) ignorée(s).`}
        </div>
      )}

      {/* Tableau par bâtiment */}
      <Titre>Distances par bâtiment et par limite</Titre>
      {controle.batiments.length === 0 ? (
        <div style={{ fontSize: 10.5, color: C.slate500 }}>Aucun bâtiment dessiné.</div>
      ) : (
        controle.batiments.map((b) => (
          <div key={b.buildingId} style={{ marginBottom: 8, border: `1px solid ${C.slate200}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", background: C.slate100 }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>{b.buildingName}</span>
              <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                {!b.insideParcel && <span style={{ fontSize: 9.5, color: VERDICT_COLORS["non-respecte"], fontWeight: 700 }}>Hors parcelle</span>}
                <Badge verdict={b.verdict} />
              </span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
              <thead>
                <tr style={{ color: C.slate500, fontSize: 9, textAlign: "left" }}>
                  <th style={{ padding: "3px 8px", fontWeight: 600 }}>Limite</th>
                  <th style={{ padding: "3px 4px", fontWeight: 600, textAlign: "right" }}>Distance</th>
                  <th style={{ padding: "3px 4px", fontWeight: 600, textAlign: "right" }}>Requis</th>
                  <th style={{ padding: "3px 8px", fontWeight: 600, textAlign: "right" }}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {b.limites.map((l) => {
                  const source = l.regle
                    ? `${l.reference ?? "référence inconnue"}${l.regle.champ ? ` · champ ${l.regle.champ}` : ""}${l.validation ? ` · validée par ${l.validation.par}` : " · non validée"}` +
                      `\n${infobulleProvenance(l.regle.provenanceValeur, doc)}`
                    : "Aucune règle rattachée";
                  return (
                    <tr key={l.segmentId} style={{ borderTop: `1px solid ${C.slate100}` }}>
                      <td style={{ padding: "3px 8px" }}>
                        <div>{LIBELLES_CATEGORIE[l.categorie]}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 9, color: C.slate400 }}>{l.segmentId}{l.origineClassement === "deduite" ? " · déduit" : ""}</div>
                      </td>
                      <td style={{ padding: "3px 4px", textAlign: "right", fontWeight: 600, color: l.horsParcelle ? VERDICT_COLORS["non-respecte"] : C.slate900 }}>
                        {l.horsParcelle ? `−${fmt(Math.abs(l.distanceSignee))}` : fmt(l.distance)}
                      </td>
                      <td style={{ padding: "3px 4px", textAlign: "right", color: C.slate700 }} title={source}>
                        {fmt(l.retraitRequis)}{l.retraitRequis !== null && <span style={{ color: C.slate400 }}> ⓘ</span>}
                      </td>
                      <td style={{ padding: "3px 8px", textAlign: "right" }}>
                        <Badge verdict={l.verdict} title={l.explication} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* Reculs de dessin */}
      <Titre>Reculs de dessin de l'enveloppe</Titre>
      <div style={{ fontSize: 10.5, color: C.slate700, lineHeight: 1.5 }}>
        Avant {fmt(reculsDessin.frontM)} · latéral {fmt(reculsDessin.sideM)} · fond {fmt(reculsDessin.rearM)}
        <div style={{ color: VERDICT_COLORS["a-verifier"], fontSize: 10 }}>Valeurs de dessin (5/3/3 m par défaut), non réglementaires : elles ne produisent aucun verdict.</div>
        {controle.regles && (
          <button
            type="button"
            style={{ ...btn, marginTop: 4 }}
            onClick={() => {
              const r = controle.regles!;
              const patch: Partial<{ frontM: number; sideM: number; rearM: number }> = {};
              if (r.voirie.regle.valeur !== null) patch.frontM = r.voirie.regle.valeur;
              if (r.separative.regle.valeur !== null) patch.sideM = r.separative.regle.valeur;
              if (r.fond.regle.valeur !== null) patch.rearM = r.fond.regle.valeur;
              onAppliquerAuDessin(patch);
            }}
          >
            Dessiner l'enveloppe avec les valeurs du règlement
          </button>
        )}
      </div>

      {/* Autres règles */}
      <Titre>Autres règles du règlement (indicatif, non contrôlées ici)</Titre>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
        <tbody>
          {[
            { label: "Hauteur max. (égout)", champ: "hauteur.max_m", regle: fmt(val(["hauteur", "max_m"])), mesure: fmt(autres.hauteurMaxMesureeM) },
            { label: "Hauteur au faîtage", champ: "hauteur.faitage_m", regle: fmt(val(["hauteur", "faitage_m"])), mesure: "—" },
            { label: "Emprise au sol (CES)", champ: "ces.max_ratio", regle: val(["ces", "max_ratio"]) === null ? "—" : `${Math.round((val(["ces", "max_ratio"]) ?? 0) * 100)} %`, mesure: autres.cesMesure === null ? "—" : `${(autres.cesMesure * 100).toFixed(1).replace(".", ",")} %` },
            { label: "Pleine terre (min.)", champ: "pleine_terre.ratio_min", regle: val(["pleine_terre", "ratio_min"]) === null ? "—" : `${Math.round((val(["pleine_terre", "ratio_min"]) ?? 0) * 100)} %`, mesure: "—" },
            { label: "Stationnement / logement", champ: "stationnement.par_logement", regle: val(["stationnement", "par_logement"]) === null ? "—" : String(val(["stationnement", "par_logement"])), mesure: autres.placesFournies === null ? "—" : `${autres.placesFournies} place(s) dessinée(s)` },
          ].map((r) => (
            <tr key={r.label} style={{ borderTop: `1px solid ${C.slate100}` }}>
              <td style={{ padding: "3px 0" }}>
                {r.label}
                {r.regle !== "—" && pv(r.champ)?.extrait && (
                  <details style={{ fontSize: 9.5, color: C.slate500 }}>
                    <summary style={{ cursor: "pointer" }}>{pv(r.champ)?.article ? `art. ${pv(r.champ)?.article}` : "extrait"}{pv(r.champ)?.page != null ? `, p. ${pv(r.champ)?.page}` : ""}</summary>
                    <span style={{ fontStyle: "italic" }}>« {pv(r.champ)?.extrait} »</span>
                  </details>
                )}
              </td>
              <td style={{ padding: "3px 4px", textAlign: "right" }} title={r.regle === "—" ? "Absent du règlement chargé" : infobulleProvenance(pv(r.champ), doc)}>{r.regle}</td>
              <td style={{ padding: "3px 4px", textAlign: "right", color: C.slate500 }}>{r.mesure}</td>
              <td style={{ padding: "3px 0", textAlign: "right" }}><Badge verdict="a-verifier" title="Hors contrôle L1b : comparaison indicative seulement" /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <details style={{ marginTop: 8, fontSize: 10, color: C.slate500 }}>
        <summary style={{ cursor: "pointer" }}>Ce que ce contrôle ne couvre pas</summary>
        <ul style={{ margin: "4px 0 0", paddingLeft: 16, lineHeight: 1.45 }}>
          {controle.horsPerimetre.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </details>
      <div style={{ marginTop: 6, fontSize: 9.5, color: C.slate400 }}>Mimmoza ne délivre pas d'attestation de conformité : seule l'autorité compétente instruit le permis.</div>
    </div>
  );
};
