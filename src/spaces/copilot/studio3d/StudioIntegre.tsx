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
import { ArrowLeft, Download, Loader2, Mountain, RotateCw } from "lucide-react";
import { demarrerPoigneeDeMain, examinerMessageStudio, originesStudio } from "@/spaces/promoteur/shared/echangeStudio/transportStudio";
import type { ProjetMimmozaV2 } from "@/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2";
import { lireFermetureStudio, messageRelief, type PoseChat } from "./projetChat";
import type { IssueRelief } from "./reliefCache";
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
}

type EtatRelief = { texte: string; erreur: boolean; enCours: boolean };

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export function StudioIntegre({ demande, ouvert, onFermer, onCadrePret }: {
  demande: DemandeStudioIntegre | null;
  ouvert: boolean;
  onFermer: (vers: "projet" | "bilan") => void;
  /** Conception (agent) : appelé à chaque « prêt » du Studio, avec sa fenêtre et son origine exacte. */
  onCadrePret?: (fenetre: Window, origine: string) => void;
}) {
  const cadre = useRef<HTMLIFrameElement | null>(null);
  const [connecte, setConnecte] = useState(false);
  const [relief, setRelief] = useState<EtatRelief | null>(null);
  const issueRelief = useRef<IssueRelief | null>(null);
  const reliefEnvoye = useRef(false);
  // La fermeture passe par une référence : un nouveau rendu du tchat ne relance pas la poignée de main.
  const fermer = useRef(onFermer);
  fermer.current = onFermer;
  const cadrePret = useRef(onCadrePret);
  cadrePret.current = onCadrePret;
  const relancer = useRef<(() => void) | null>(null);
  const [ifc, setIfc] = useState<string | null>(null);

  /** R6 — « Télécharger l'IFC 4 » : demande à Studio (protocole mimmoza.studio.ifc4), même origine. */
  const telechargerIfc = () => {
    const f = cadre.current?.contentWindow;
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
    if (!demande) return;
    setConnecte(false);
    issueRelief.current = null;
    reliefEnvoye.current = false;
    const origine = new URL(demande.url).origin;
    const autorisees = originesStudio(ENV.VITE_STUDIO_ORIGINES_AUTORISEES, demande.url);
    let poignee: ReturnType<typeof demarrerPoigneeDeMain> | null = null;
    const envoyerRelief = () => {
      const f = cadre.current?.contentWindow;
      const issue = issueRelief.current;
      if (!f || !issue || reliefEnvoye.current || !poignee?.connecte()) return;
      reliefEnvoye.current = true;
      f.postMessage(messageRelief(demande.sessionId, issue.ok ? { ok: true, terrain: issue.terrain } : { ok: false, message: issue.message }, issue.ok ? demande.implantation : null), origine);
    };
    const demarrer = () => {
      const f = cadre.current?.contentWindow;
      if (!f || poignee) return;
      poignee = demarrerPoigneeDeMain(f, origine, demande.sessionId, demande.projet, { maintenir: true, dureeMaxMs: 90_000 });
    };
    const surMessage = (evt: MessageEvent) => {
      if (evt.source !== cadre.current?.contentWindow) return;
      const vers = lireFermetureStudio(evt.data);
      if (vers && evt.origin === origine) { fermer.current(vers); return; }
      const d = examinerMessageStudio({ origin: evt.origin, data: evt.data }, autorisees, window.location.origin, new Set([demande.sessionId]), Boolean(ENV.DEV));
      if (d.type === "pret") {
        poignee?.surPret(d.attendProjet); setConnecte(true); envoyerRelief();
        const f = cadre.current?.contentWindow;
        if (f) cadrePret.current?.(f, origine);
      }
    };
    window.addEventListener("message", surMessage);
    // La fenêtre du cadre (WindowProxy) existe dès le montage : les « bonjour » envoyés
    // avant le chargement de Studio sont simplement perdus (cible d'origine exacte).
    demarrer();

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
      return () => { actif = false; relancer.current = null; window.removeEventListener("message", surMessage); poignee?.arreter(); };
    }
    return () => { window.removeEventListener("message", surMessage); poignee?.arreter(); };
  }, [demande]);

  if (!demande) return null;
  return (
    <div className={`studio-integre${ouvert ? " is-open" : ""}`} role="dialog" aria-label="Studio 3D" aria-hidden={!ouvert}>
      <header className="studio-integre__bar">
        <button type="button" className="studio-integre__back" onClick={() => onFermer("projet")}><ArrowLeft size={16} /> Retour au projet</button>
        <strong>Studio 3D</strong>
        <button type="button" className="studio-integre__back" disabled={!connecte} onClick={telechargerIfc} title="Export IFC 4 du modèle ouvert dans Studio"><Download size={15} /> IFC 4</button>
        <button type="button" className="studio-integre__back" onClick={() => onFermer("bilan")}>{demande?.projet.etudeId ? "Bilan" : "Bilan (étude à relier)"}</button>
        {ifc && <span className="studio-integre__chip" role="status">{ifc}</span>}
        {!connecte && <span className="studio-integre__chip"><Loader2 size={13} className="studio-integre__spin" /> Ouverture de Studio…</span>}
        {relief && <span className={`studio-integre__chip${relief.erreur ? " is-error" : ""}`} role="status">
          {relief.enCours ? <Loader2 size={13} className="studio-integre__spin" /> : <Mountain size={13} />} {relief.texte}
          {relief.erreur && <button type="button" onClick={() => relancer.current?.()}><RotateCw size={12} /> Réessayer</button>}
        </span>}
        {demande.imagesNonEnvoyees > 0 && <span className="studio-integre__chip">{demande.imagesNonEnvoyees} image(s) du tchat non envoyée(s) : « Préparer en détail » pour les classer.</span>}
      </header>
      <iframe key={demande.cle} ref={cadre} className="studio-integre__frame" src={demande.url} title="Studio 3D Mimmoza"
        allow="fullscreen; clipboard-write; xr-spatial-tracking" />
    </div>
  );
}
