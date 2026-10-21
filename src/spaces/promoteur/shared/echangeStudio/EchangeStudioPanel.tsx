// src/spaces/promoteur/shared/echangeStudio/EchangeStudioPanel.tsx
//
// LOT L3 — aller-retour Implantation 2D ⇄ Studio 3D (contrat `mimmoza-projet-v2`).
//   - « Studio 3D ⇄ » : envoie parcelles, relief, bâtiments, règles sourcées et contrôle.
//   - Les retours de Studio (postMessage filtré, ou ancre `#studio-retour=`) sont MIS EN
//     ATTENTE et persistés (par utilisateur et par étude) ; Mimmo affiche ce qui a changé,
//     le contrôle RECALCULÉ par Mimmoza, et l'utilisateur confirme avant application.
//   - Un conflit (les deux côtés ont changé) est signalé, jamais écrasé en silence.

import type { Feature, MultiPolygon, Polygon } from "geojson";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { userStorage } from "@/lib/storage/userScopedStorage";
import { useEditor2DStore } from "../../plan2d/editor2d.store";
import { genId } from "../../plan2d/editor2d.geometry";
import type { Point2D } from "../../plan2d/editor2d.types";
import { anneauxDepuisFeatureLocale } from "../../implantation/adapters";
import type { EtatControle } from "../../implantation/useControleImplantation";
import { VERDICT_LABELS } from "../../implantation/implantationCheck";
import { adresseAvecTransfert, ErreurStudio3D, urlStudio3D, type TerrainStudio } from "../ouvrirStudio3D";
// R2 — relief en cache par parcelle (IndexedDB) : une parcelle déjà mesurée part sans attendre.
import { reliefAvecDelai } from "@/spaces/copilot/studio3d/reliefCache";
import { ancreEnvoi, decoderProjet, lireAncre, nouvelleRevision, type ProjetMimmozaV2 } from "./mimmozaProjetV2";
import {
  appliquerRetourAuPlan, baseApresAcceptation, classerChangements, comparerVerdicts, controleRecalcule, projectionDepuisFeature, projetDepuisPromoteur,
} from "./projetPromoteur";
import {
  accepterRetour, ecrireEchangeStocke, enregistrerEnvoi, ignorerRetour, lireEchangeStocke, nouvelEchange, parentPourEnvoi, recevoirRetour,
  type AnalyseRetour, type EchangeStocke,
} from "./persistanceEchange";
import { demarrerPoigneeDeMain, examinerMessageStudio, originesStudio } from "./transportStudio";

const ENV = (import.meta as unknown as { env?: Record<string, unknown> }).env;
const ORIGINES_ENV = ENV?.VITE_STUDIO_ORIGINES_AUTORISEES as string | undefined;
/**
 * R2/R3 — exception localhost réservée au serveur de développement : active seulement si
 * `import.meta.env.DEV === true` (sous `npm run dev`) ; désactivée en production et si l'environnement est absent.
 */
const DEV_LOCAL = ENV?.DEV === true;

export interface EchangeStudioPanelProps {
  readonly studyId: string | null;
  /** Feature WGS 84 combinée (restore.combinedFeature). */
  readonly combinedFeature: Feature<Polygon | MultiPolygon> | null;
  readonly parcelles: readonly { readonly id: string; readonly feature: unknown }[];
  readonly communeInsee: string | null;
  readonly parcelleLocal: readonly Point2D[];
  readonly featureLocale: Feature<Polygon | MultiPolygon> | null;
  readonly controleEtat: EtatControle;
}

const maintenant = (): string => new Date().toISOString();
const aleatoire = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function urlStudioOuNull(): string | null {
  try { return urlStudio3D(); } catch { return null; }
}

export const EchangeStudioPanel: React.FC<EchangeStudioPanelProps> = ({ studyId, combinedFeature, parcelles, communeInsee, parcelleLocal, featureLocale, controleEtat }) => {
  const [echange, setEchange] = useState<EchangeStocke>(() => lireEchangeStocke(userStorage, studyId) ?? nouvelEchange(studyId, aleatoire, maintenant()));
  const [analyse, setAnalyse] = useState<AnalyseRetour | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const echangeRef = useRef(echange);
  const ongletRef = useRef<Window | null>(null);
  const poigneeRef = useRef<ReturnType<typeof demarrerPoigneeDeMain> | null>(null);

  const persister = useCallback((e: EchangeStocke) => {
    echangeRef.current = e;
    setEchange(e);
    if (!ecrireEchangeStocke(userStorage, e)) setMessage("Stockage local plein : l’échange avec Studio n’a pas pu être mémorisé.");
  }, []);

  // Changement d'étude : relecture (reprise après fermeture du navigateur).
  useEffect(() => {
    const e = lireEchangeStocke(userStorage, studyId) ?? nouvelEchange(studyId, aleatoire, maintenant());
    echangeRef.current = e;
    setEchange(e);
    setAnalyse(null);
  }, [studyId]);

  const projectionWgs = useMemo(() => projectionDepuisFeature(combinedFeature), [combinedFeature]);
  const anneaux = useMemo(() => {
    if (parcelleLocal.length < 3) return [];
    return [parcelleLocal.map((p) => ({ x: p.x, y: p.y })), ...anneauxDepuisFeatureLocale(featureLocale).anneaux.slice(1)];
  }, [parcelleLocal, featureLocale]);

  const projetLocal = useCallback((e: EchangeStocke, relief: TerrainStudio | null, session: ProjetMimmozaV2["session"]): ProjetMimmozaV2 | string => {
    const lu = projetDepuisPromoteur({
      projetId: e.projetId, etudeId: e.etudeId, horodatage: maintenant(), session,
      featureCombinee: combinedFeature, parcelles, communeInsee, adresse: null, pointAdresse: null, relief,
      buildings: useEditor2DStore.getState().buildings, base: e.base, refsFront: e.refsFront,
      etatRuleset: controleEtat.etatRuleset, validations: controleEtat.validations, controle: controleEtat.controle, logementsVises: null,
    });
    return lu.ok ? lu.projet : lu.erreur;
  }, [combinedFeature, parcelles, communeInsee, controleEtat]);

  const recevoir = useCallback((projet: ProjetMimmozaV2, provenance: string) => {
    const e = echangeRef.current;
    const local = projetLocal(e, null, e.base?.session ?? null);
    const a = recevoirRetour(e, projet, typeof local === "string" ? null : local, maintenant());
    if ("erreur" in a) { setMessage(a.erreur); return; }
    persister(a.echange);
    // R2 — aucune différence : pas de fenêtre.
    if (a.aucuneDifference) { setMessage(`Studio est à jour : aucune différence avec votre plan (${provenance}).`); return; }
    setAnalyse(a);
    setMessage(`Retour de Studio reçu (${provenance}).`);
  }, [persister, projetLocal]);

  // Retours en direct (postMessage) : origine en liste blanche, forme validée, session connue.
  useEffect(() => {
    const onMessage = (evt: MessageEvent): void => {
      const sid = echangeRef.current.sessionId;
      const d = examinerMessageStudio({ origin: evt.origin, data: evt.data }, originesStudio(ORIGINES_ENV, urlStudioOuNull()), window.location.origin, new Set(sid ? [sid] : []), DEV_LOCAL);
      if (d.type === "pret") { if (evt.source === ongletRef.current) poigneeRef.current?.surPret(d.attendProjet); }
      // R2 — le retour doit venir de l'onglet Studio ouvert d'ici (sauf après rechargement de cette page, où la poignée est perdue).
      else if (d.type === "retour" && (ongletRef.current === null || evt.source === ongletRef.current)) recevoir(d.projet, "fenêtre Studio");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [recevoir]);

  // Retour par adresse (`#studio-retour=…`) quand la fenêtre Mimmoza avait été fermée ; retour en attente après rechargement.
  useEffect(() => {
    const ancre = typeof window !== "undefined" ? lireAncre(window.location.hash) : null;
    if (ancre?.type === "retour") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      const lu = decoderProjet(ancre.code);
      if (!lu.ok) setMessage(`Retour de Studio illisible : ${lu.erreur}`);
      else recevoir(lu.projet, `lien de retour${lu.avertissements.length > 0 ? ` — ${lu.avertissements.join(" ; ")}` : ""}`);
      return;
    }
    const enAttente = echangeRef.current.enAttente;
    if (enAttente) recevoir(enAttente, "en attente depuis la dernière visite");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyId]);

  useEffect(() => () => poigneeRef.current?.arreter(), []);

  const ouvrir = useCallback(async () => {
    setMessage(null);
    let base: string;
    try { base = urlStudio3D(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); return; }
    const onglet = window.open("about:blank", "_blank");
    // Correctif : l'onglet restait vide pendant le chargement du relief — on affiche une attente.
    try {
      onglet?.document.write('<!doctype html><meta charset="utf-8"><title>Mimmoza — Studio 3D</title><body style="font-family:system-ui,sans-serif;padding:2rem;color:#4b3f72"><p>Préparation du projet pour Studio 3D…</p><p style="color:#777">Chargement du relief du terrain (15 s maximum).</p></body>');
      onglet?.document.close();
    } catch { /* onglet inaccessible : sans conséquence */ }
    setEnvoi(true);
    try {
      let relief: TerrainStudio | null = null;
      let reliefAbandonne = false;
      if (parcelles.length > 0 && parcelles.every((p) => p.feature)) {
        // R2 — cache d'abord (instantané), sinon mesure avec délai maximal de 15 s ; la mesure
        // engagée continue et remplit le cache, si bien que l'ouverture suivante n'attend plus.
        const issue = await reliefAvecDelai(parcelles.map((p) => ({ id: p.id, feature: p.feature })), communeInsee ?? null, { delaiMs: 15000 });
        if (issue.ok) relief = issue.terrain;
        else reliefAbandonne = issue.raison === "delai";
      }
      const e = echangeRef.current;
      const session = { id: aleatoire(), conversationId: null, retourOrigine: window.location.origin, retourUrl: window.location.origin + window.location.pathname + window.location.search };
      const local = projetLocal(e, relief, session);
      if (typeof local === "string") throw new ErreurStudio3D(local);
      // R2 — le parent désigne le retour Studio accepté (Studio reconnaît sa propre version : pas de faux conflit).
      const projet = { ...nouvelleRevision(local, "mimmoza-front", maintenant(), e.base), parentEmpreinte: parentPourEnvoi(e) };
      const { ancre, parPostMessage } = ancreEnvoi(projet);
      // R4/R5 — l'étude est annoncée à Studio (`?etude=`) : le métré du modèle se relie au bilan sans clic.
      const avecEtude = new URL(base);
      if (studyId && /^[\w-]{1,128}$/.test(studyId)) avecEtude.searchParams.set("etude", studyId);
      const url = adresseAvecTransfert(avecEtude.href, ancre);
      if (!onglet) throw new ErreurStudio3D("Le navigateur a bloqué l’ouverture de Studio : autorisez les fenêtres pour Mimmoza.");
      onglet.opener = null;
      onglet.location.href = url;
      ongletRef.current = onglet;
      persister(enregistrerEnvoi(e, projet, maintenant()));
      poigneeRef.current?.arreter();
      poigneeRef.current = demarrerPoigneeDeMain(onglet, new URL(url).origin, session.id, parPostMessage ? projet : null, { maintenir: true });
      setMessage(`Envoyé à Studio : ${String(projet.batiments.length)} bâtiment(s), révision ${String(projet.revision)}${parPostMessage ? " (projet volumineux : transmis après la poignée de main)" : ""}${reliefAbandonne ? " — relief non chargé en 15 s : terrain envoyé à plat (à vérifier)" : ""}.`);
    } catch (e) {
      onglet?.close();
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  }, [parcelles, communeInsee, projetLocal, persister, studyId]);

  // Aperçu de ce que deviendrait le plan, et contrôle RECALCULÉ par Mimmoza.
  const apercu = useMemo(() => {
    if (!analyse || !projectionWgs) return null;
    const e = echangeRef.current;
    const app = appliquerRetourAuPlan(useEditor2DStore.getState().buildings, analyse.retour, e.base, e.refsFront, projectionWgs, genId);
    const controle = anneaux.length > 0
      ? controleRecalcule(controleEtat.segments, anneaux, app.buildings, controleEtat.etatRuleset, controleEtat.validations, communeInsee)
      : null;
    return { app, controle, comparaison: controle ? comparerVerdicts(controle, analyse.retour.controle, app.refsFront) : null, classes: classerChangements(analyse.changements) };
  }, [analyse, projectionWgs, anneaux, controleEtat, communeInsee]);

  const appliquer = useCallback(() => {
    if (!analyse || !apercu) return;
    const st = useEditor2DStore.getState();
    const local = projetLocal(echangeRef.current, null, echangeRef.current.base?.session ?? null);
    st.loadSnapshot(apercu.app.buildings, st.parkings);
    // R2 — règles, parcelles et site restent ceux de Mimmoza dans la base commune (non appliqués).
    persister(accepterRetour(echangeRef.current, baseApresAcceptation(analyse.retour, typeof local === "string" ? null : local), apercu.app.refsFront, maintenant(), analyse.retour));
    setAnalyse(null);
    setMessage("Modifications de Studio appliquées au plan. Le contrôle d’implantation a été recalculé par Mimmoza.");
  }, [analyse, apercu, persister]);

  const ignorer = useCallback(() => {
    persister(ignorerRetour(echangeRef.current, maintenant()));
    setAnalyse(null);
    setMessage("Version de Studio écartée : votre plan est conservé. Renvoyez-le à Studio pour les resynchroniser.");
  }, [persister]);

  const bouton: React.CSSProperties = { padding: "7px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.15)", color: "white", fontWeight: 600, fontSize: 12, cursor: envoi ? "wait" : "pointer", flexShrink: 0 };
  const conflit = analyse?.etat === "conflit";

  return (
    <>
      <button type="button" onClick={() => { void ouvrir(); }} disabled={envoi} style={bouton}
        title={`Ouvrir ce plan dans Studio 3D et recevoir ses modifications${echange.base ? ` — dernier échange : révision ${String(echange.base.revision)}` : ""}`}>
        {envoi ? "Préparation…" : "⇄ Studio 3D"}
      </button>
      {message && !analyse && (
        <span role="status" style={{ fontSize: 11, color: "white", opacity: 0.9, maxWidth: 320 }}>{message}
          <button type="button" onClick={() => setMessage(null)} aria-label="Fermer" style={{ marginLeft: 6, background: "none", border: "none", color: "white", cursor: "pointer" }}>×</button>
        </span>
      )}
      {analyse && (
        <div role="dialog" aria-modal="true" aria-label="Modifications reçues de Studio"
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "white", color: "#0f172a", borderRadius: 14, maxWidth: 560, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Studio a modifié le projet</h2>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "#475569" }}>Révision {analyse.retour.revision} reçue le {new Date(analyse.retour.horodatage).toLocaleString("fr-FR")}. Rien n’est appliqué sans votre confirmation.</p>
            {conflit && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10, fontSize: 12, marginBottom: 10 }}>
                <strong>Conflit de version.</strong> Le plan a aussi été modifié ici depuis l’envoi :
                <ul style={{ margin: "4px 0 0 18px" }}>{analyse.changementsLocaux.map((c, i) => <li key={i}>{c.libelle}</li>)}</ul>
                Appliquer la version de Studio remplacera ces modifications.
              </div>
            )}
            {apercu && apercu.classes.appliques.length > 0 && (<>
              <h3 style={{ fontSize: 13, margin: "6px 0 2px" }}>Appliqué au plan 2D</h3>
              <ul style={{ margin: "0 0 8px 18px", fontSize: 13 }}>{apercu.classes.appliques.map((c, i) => <li key={i}>{c.libelle}</li>)}</ul>
            </>)}
            {apercu && apercu.classes.conserves.length > 0 && (<>
              <h3 style={{ fontSize: 13, margin: "6px 0 2px" }}>Repris dans le projet, sans effet sur le dessin 2D</h3>
              <ul style={{ margin: "0 0 8px 18px", fontSize: 12, color: "#334155" }}>{apercu.classes.conserves.map((c, i) => <li key={i}>{c.libelle}</li>)}</ul>
            </>)}
            {apercu && apercu.classes.aConfirmer.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 8, fontSize: 12, margin: "6px 0" }}>
                <strong>À confirmer dans Mimmoza — non appliqué :</strong>
                <ul style={{ margin: "4px 0 0 18px" }}>{apercu.classes.aConfirmer.map((c, i) => <li key={i}>{c.libelle}</li>)}</ul>
                Les règles et la parcelle restent celles du parcours Foncier / PLU. Une validation faite dans Studio n’est jamais reprise sans confirmation dans ce parcours.
              </div>
            )}
            {apercu?.app.nonApplique.map((t, i) => <p key={i} style={{ fontSize: 12, color: "#92400e", margin: "4px 0" }}>{t}</p>)}
            {apercu?.controle && (
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, fontSize: 12, margin: "10px 0" }}>
                <strong>Contrôle d’implantation recalculé par Mimmoza :</strong> {apercu.controle.libelleNiveau}
                <ul style={{ margin: "4px 0 0 18px" }}>{apercu.controle.batiments.map((b) => <li key={b.buildingId}>{b.buildingName} : {VERDICT_LABELS[b.verdict]}</li>)}</ul>
                {apercu.comparaison && <p style={{ margin: "6px 0 0" }}>{apercu.comparaison.libelle}</p>}
                {apercu.comparaison?.divergences.map((d, i) => <p key={i} style={{ margin: "2px 0 0", color: "#b91c1c" }}>{d}</p>)}
                <p style={{ margin: "6px 0 0", color: "#64748b" }}>Le verdict transmis par Studio reste indicatif ; aucun projet n’est déclaré conforme sur cette seule base.</p>
              </div>
            )}
            {!projectionWgs && <p style={{ fontSize: 12, color: "#b91c1c" }}>Parcelle sans géométrie : le retour ne peut pas être placé sur le plan.</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={ignorer} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer" }}>
                {conflit ? "Garder ma version" : "Ignorer"}
              </button>
              <button type="button" onClick={appliquer} disabled={!apercu || apercu.classes.appliques.length + apercu.classes.conserves.length === 0}
                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: conflit ? "#b91c1c" : "#4f46e5", color: "white", fontWeight: 600, cursor: "pointer" }}>
                {conflit ? "Appliquer quand même" : "Appliquer au plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
