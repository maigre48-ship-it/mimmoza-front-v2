// src/spaces/copilot/studio3d/StudioIntegre.tsx
//
// R2 — STUDIO DANS LA PAGE DU TCHAT (panneau plein écran, même origine).
//
// Choix : un panneau intégré (iframe de /studio/, même origine — R1) plutôt
// qu'une navigation du même onglet vers /studio/ :
//   - le tchat reste vivant derrière (conversation, fiche, pièces jointes en
//     mémoire, flux en cours) : « Retour au projet » est instantané, sans
//     rechargement ni perte ;
//   - le relief se mesure en tâche de fond avec la session Supabase du front et
//     arrive dans Studio quand il est prêt (Studio n'a pas à se connecter) ;
//   - Studio reste chargé quand on revient au tchat : rouvrir est instantané ;
//   - même origine : canaux BroadcastChannel/localStorage partagés (volumes du
//     tchat, et le bilan en temps réel R4/R5 peut écouter la même fenêtre).
// Jamais d'onglet about:blank : le panneau s'affiche au clic, Studio s'y charge,
// et un bandeau dit où en est le relief (délai maximal 25 s, message clair).

import { useEffect, useRef, useState } from "react";
import { Box, Download, ExternalLink, Loader2, Mountain, RotateCw, X } from "lucide-react";
import { demarrerPoigneeDeMain, examinerMessageStudio, originesStudio } from "@/spaces/promoteur/shared/echangeStudio/transportStudio";
import type { ProjetMimmozaV2 } from "@/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2";
import { DELAI_STUDIO_MUET_MS, lireFermetureStudio, messageRelief, messageStudioMuet, type PoseChat } from "./projetChat";
import type { IssueRelief } from "./reliefCache";
// LOT F5 — relevé de l'existant VALIDÉ dans le Studio (lecture de plan / photo calée), renvoyé au site.
import { lireRetourReleve, TYPE_RETOUR_RELEVE, type SyntheseReleve } from "./planExistantStudio";
import "./StudioIntegre.css";

export interface DemandeStudioIntegre {
  /** Change à chaque nouvel envoi (recharge le panneau). */
  cle: string;
  url: string;
  sessionId: string;
  projet: ProjetMimmozaV2;
  /** Relief connu à l'envoi (dans le projet) ou à venir (promesse, délai maximal compris). */
  relief: { etat: "inclus"; source: "cache" | "mesure" } | { etat: "differe"; promesse: Promise<IssueRelief>; relancer: () => Promise<IssueRelief> } | { etat: "sans-parcelle" };
  implantation: PoseChat | null;
  imagesNonEnvoyees: number;
  /** LOT D9 — « Préparer mon dossier » : `projetExtension` (contrat X0) et `dossier` joints au message « projet ».
   *  LOT F5 — aussi `planExistant` (plan à lire) et `photoCalee` (photo et plan de calage d'un travail d'image). */
  complements?: Readonly<Record<string, unknown>>;
}

type EtatRelief = { texte: string; erreur: boolean; enCours: boolean };

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Nom de l'onglet du Studio : un seul onglet, réutilisé d'une ouverture à l'autre. */
const NOM_ONGLET_STUDIO = "mimmoza-studio";

export function StudioIntegre({ demande, ouvert, onFermer, onCadrePret, onReleve }: {
  demande: DemandeStudioIntegre | null;
  ouvert: boolean;
  onFermer: (vers: "projet" | "bilan") => void;
  /** Conception (agent) : appelé à chaque « prêt » du Studio, avec sa fenêtre et son origine exacte. */
  onCadrePret?: (fenetre: Window, origine: string) => void;
  /** LOT F5 — relevé de l'existant posé (validé) dans le Studio : synthèse relue pour les écrans du site. */
  onReleve?: (synthese: SyntheseReleve) => void;
}) {
  const [connecte, setConnecte] = useState(false);
  // 23/11 — le Studio s'ouvre dans un NOUVEL ONGLET (le chat reste la trame principale, entier, dans le sien). La
  // poignée de main, le relief, l'IFC et le pont du parcours parlent à la fenêtre de cet onglet (même protocole qu'avec
  // l'ancien cadre). Ouverture bloquée par le navigateur (pas de clic récent) → bouton dans le bandeau.
  const fenetre = useRef<Window | null>(null);
  const cible = (): Window | null => { const f = fenetre.current; return f && !f.closed ? f : null; };
  const [generation, setGeneration] = useState(0);
  const [bloque, setBloque] = useState(false);
  const [masque, setMasque] = useState(false);
  const derniereCle = useRef<string | null>(null);
  const ouvrirOnglet = (forcer = false) => {
    if (!demande) return;
    const nouvelle = forcer || derniereCle.current !== demande.cle || !cible();
    // Onglet nommé : une nouvelle maquette le recharge, la même maquette le ramène simplement au premier plan.
    const w = window.open(nouvelle ? demande.url : "", NOM_ONGLET_STUDIO);
    if (!w) { setBloque(true); return; }
    setBloque(false);
    derniereCle.current = demande.cle;
    if (nouvelle) { fenetre.current = w; setGeneration((g) => g + 1); }
  };
  useEffect(() => {
    if (!demande || !ouvert) return;
    setMasque(false);
    ouvrirOnglet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demande?.cle, ouvert]);
  // Retour sur l'onglet du chat : l'état « ouvert » retombe, pour que la prochaine demande ramène l'onglet du Studio.
  useEffect(() => {
    if (!ouvert) return;
    const surRetour = () => { if (!bloque) fermer.current("projet"); };
    window.addEventListener("focus", surRetour);
    return () => window.removeEventListener("focus", surRetour);
  }, [ouvert, bloque]);
  const [relief, setRelief] = useState<EtatRelief | null>(null);
  const issueRelief = useRef<IssueRelief | null>(null);
  const reliefEnvoye = useRef(false);
  // La fermeture passe par une référence : un nouveau rendu du tchat ne relance pas la poignée de main.
  const fermer = useRef(onFermer);
  fermer.current = onFermer;
  const cadrePret = useRef(onCadrePret);
  cadrePret.current = onCadrePret;
  const surReleve = useRef(onReleve);
  surReleve.current = onReleve;
  const [releve, setReleve] = useState<string | null>(null);
  const relancer = useRef<(() => void) | null>(null);
  const [ifc, setIfc] = useState<string | null>(null);
  // LIAISON 03/11 — Studio qui ne répond pas : un message clair au lieu d'un « Ouverture de Studio… » sans fin.
  const [muet, setMuet] = useState(false);

  /** R6 — « Télécharger l'IFC 4 » : demande à Studio (protocole mimmoza.studio.ifc4), même origine. */
  const telechargerIfc = () => {
    const f = cible();
    if (!f || !demande) return;
    const origine = new URL(demande.url).origin;
    const requeteId = crypto.randomUUID();
    setIfc("Export IFC 4 en cours…");
    const surReponse = (evt: MessageEvent) => {
      const d = evt.data as { type?: string; requeteId?: string; ok?: boolean; erreur?: string; nomFichier?: string; octets?: ArrayBuffer } | null;
      if (evt.origin !== origine || evt.source !== f || d?.type !== "mimmoza.studio.ifc4.reponse" || d.requeteId !== requeteId) return;
      window.removeEventListener("message", surReponse);
      if (!d.ok || !d.octets) { setIfc(`IFC 4 indisponible : ${d.erreur ?? "réponse vide"}`); return; }
      const lien = document.createElement("a");
      lien.href = URL.createObjectURL(new Blob([d.octets], { type: "application/x-step" }));
      lien.download = d.nomFichier ?? "projet.ifc";
      lien.click();
      setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
      setIfc(`IFC 4 téléchargé : ${lien.download}`);
    };
    window.addEventListener("message", surReponse);
    setTimeout(() => window.removeEventListener("message", surReponse), 60_000);
    f.postMessage({ type: "mimmoza.studio.ifc4.demande", version: 1, requeteId, interieurs: "auto" }, origine);
  };

  // Une demande = une session : poignée de main, envoi du projet, puis du relief.
  useEffect(() => {
    if (!demande || !cible()) return;
    setConnecte(false);
    setMuet(false);
    setReleve(null);
    issueRelief.current = null;
    reliefEnvoye.current = false;
    const origine = new URL(demande.url).origin;
    const autorisees = originesStudio(ENV.VITE_STUDIO_ORIGINES_AUTORISEES, demande.url);
    let poignee: ReturnType<typeof demarrerPoigneeDeMain> | null = null;
    const envoyerRelief = () => {
      const f = cible();
      const issue = issueRelief.current;
      if (!f || !issue || reliefEnvoye.current || !poignee?.connecte()) return;
      reliefEnvoye.current = true;
      f.postMessage(messageRelief(demande.sessionId, issue.ok ? { ok: true, terrain: issue.terrain } : { ok: false, message: issue.message }, issue.ok ? demande.implantation : null), origine);
    };
    const demarrer = () => {
      const f = cible();
      if (!f || poignee) return;
      poignee = demarrerPoigneeDeMain(f, origine, demande.sessionId, demande.projet, { maintenir: true, dureeMaxMs: 90_000, ...(demande.complements ? { complements: demande.complements } : {}) });
    };
    const surMessage = (evt: MessageEvent) => {
      if (!cible() || evt.source !== cible()) return;
      const vers = lireFermetureStudio(evt.data);
      if (vers && evt.origin === origine) { fermer.current(vers); return; }
      // LOT F5 — relevé validé : même fenêtre, même origine, session de cette demande ; relu sans rien compléter.
      if (evt.origin === origine && (evt.data as { type?: unknown } | null)?.type === TYPE_RETOUR_RELEVE) {
        const rr = lireRetourReleve(evt.data, demande.sessionId, Date.now());
        if (!rr.ok) { setReleve(`Relevé du Studio ignoré : ${rr.raison}.`); return; }
        setReleve(`Relevé de l’existant reçu : ${rr.synthese.baies.length} baie(s)${rr.synthese.pieces.length ? `, ${rr.synthese.pieces.length} pièce(s)` : ""}.`);
        surReleve.current?.(rr.synthese);
        return;
      }
      const d = examinerMessageStudio({ origin: evt.origin, data: evt.data }, autorisees, window.location.origin, new Set([demande.sessionId]), Boolean(ENV.DEV));
      if (d.type === "pret") {
        poignee?.surPret(d.attendProjet); setConnecte(true); setMuet(false); envoyerRelief();
        const f = cible();
        if (f) cadrePret.current?.(f, origine);
      }
    };
    window.addEventListener("message", surMessage);
    // La fenêtre du cadre (WindowProxy) existe dès le montage : les « bonjour » envoyés
    // avant le chargement de Studio sont simplement perdus (cible d'origine exacte).
    demarrer();
    const delaiMuet = window.setTimeout(() => { if (!poignee?.connecte()) setMuet(true); }, DELAI_STUDIO_MUET_MS);

    if (demande.relief.etat === "inclus") setRelief({ texte: demande.relief.source === "cache" ? "Relief mesuré (déjà en cache) envoyé avec la parcelle." : "Relief mesuré envoyé avec la parcelle.", erreur: false, enCours: false });
    else if (demande.relief.etat === "sans-parcelle") setRelief(null);
    else {
      setRelief({ texte: "Studio s’ouvre sur la parcelle ; le relief est en cours de mesure (25 s au plus) et s’appliquera dès son arrivée.", erreur: false, enCours: true });
      let actif = true;
      const traiter = (issue: IssueRelief) => {
        if (!actif) return;
        issueRelief.current = issue;
        reliefEnvoye.current = false;
        setRelief(issue.ok
          ? { texte: issue.source === "cache" ? "Relief mesuré (cache) transmis à Studio." : "Relief mesuré transmis à Studio.", erreur: false, enCours: false }
          : { texte: `Relief indisponible : ${issue.message}. Studio garde un terrain plat provisoire.`, erreur: true, enCours: false });
        envoyerRelief();
      };
      const r = demande.relief;
      relancer.current = () => {
        setRelief({ texte: "Nouvelle tentative de mesure du relief (25 s au plus)…", erreur: false, enCours: true });
        void r.relancer().then(traiter);
      };
      void r.promesse.then(traiter);
      return () => { actif = false; relancer.current = null; window.clearTimeout(delaiMuet); window.removeEventListener("message", surMessage); poignee?.arreter(); };
    }
    return () => { window.clearTimeout(delaiMuet); window.removeEventListener("message", surMessage); poignee?.arreter(); };
  }, [demande, generation]);

  if (!demande || masque) return null;
  const versStudio = () => ouvrirOnglet(!cible());
  return (
    <div className="studio-onglet" role="status" aria-label="Studio 3D">
      <strong><Box size={15} aria-hidden="true" /> Studio 3D</strong>
      {bloque
        ? <><span className="studio-onglet__texte">Votre projet est prêt. Le navigateur a retenu l’ouverture automatique :</span>
          <button type="button" className="studio-onglet__btn is-primaire" onClick={() => ouvrirOnglet(true)}><ExternalLink size={14} aria-hidden="true" /> Ouvrir le Studio (nouvel onglet)</button></>
        : <><span className="studio-onglet__texte">{connecte ? "ouvert dans un autre onglet — le chat reste ici." : muet ? messageStudioMuet(demande.url, window.location.origin) : "ouverture dans un nouvel onglet…"}</span>
          <button type="button" className="studio-onglet__btn" onClick={versStudio}><ExternalLink size={14} aria-hidden="true" /> Aller au Studio</button>
          <button type="button" className="studio-onglet__btn" disabled={!connecte} onClick={telechargerIfc} title="Export IFC 4 du modèle ouvert dans Studio"><Download size={14} aria-hidden="true" /> IFC 4</button></>}
      {ifc && <span className="studio-onglet__chip">{ifc}</span>}
      {releve && <span className="studio-onglet__chip">{releve}</span>}
      {relief && (relief.erreur || relief.enCours) && <span className={`studio-onglet__chip${relief.erreur ? " is-error" : ""}`}>
        {relief.enCours ? <Loader2 size={13} className="studio-integre__spin" /> : <Mountain size={13} />} {relief.texte}
        {relief.erreur && <button type="button" onClick={() => relancer.current?.()}><RotateCw size={12} /> Réessayer</button>}
      </span>}
      <button type="button" className="studio-onglet__fermer" aria-label="Masquer ce bandeau" title="Masquer ce bandeau" onClick={() => setMasque(true)}><X size={14} /></button>
    </div>
  );
}
