// src/spaces/copilot/agent/conception/AtelierConception.tsx
// =============================================================================
// L'Atelier 3D en mode CONCEPTION : le Studio du site (/studio/, même origine,
// via StudioIntegre) reçoit `conception.ouvrir` (parcelle réelle, règles PLU,
// programme, voie du plan) ; il renvoie `conception.metriques` à chaque
// modification et `conception.enregistrer` pour une version. À côté, le BILAN
// VIVANT se recalcule (bilanCalcul.ts) et la conformité PLU s'affiche.
// Monté une fois dans MimmozIAPage ; s'ouvre via useAtelierConception().ouvrir.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { urlStudio } from '@/lib/studioConfig';
import {
  creerMessageConception, lireMessageConception, type ChargeMetriques, type ChargeOuvrir,
} from '@/spaces/promoteur/shared/echangeStudio/conception';
import { StudioIntegre, type DemandeStudioIntegre } from '../../studio3d/StudioIntegre';
import { adresseStudioIntegre, projetIdChat } from '../../studio3d/projetChat';
import { conversationConception, inseeConception, parcellesConception, projetConception } from './projetConception';
import { reliefAvecDelai } from '../../studio3d/reliefCache';
import { useAgentUi } from '../agentUi.store';
import { construireModeleRapport, type ModeleRapport } from '../rapport/rapportModele';
import { enregistrerVersion, lireMissionOrigine, listerVersions } from './conceptionApi';
import {
  bilanVersion, DELAI_ENVOI_MS, DELAI_STUDIO_ANCIEN_MS, entreesConception, ouvertureInitiale, peutTraiter, transitionOuverture,
  type EvenementOuverture, type VersionConception,
} from './conceptionLogique';
import { useAtelierConception } from './conceptionUi.store';
import { BilanVivant } from './BilanVivant';
import './conception.css';

export function AtelierConception() {
  const demande = useAtelierConception((s) => s.demande);
  const ouvert = useAtelierConception((s) => s.ouvert);
  const [rapport, setRapport] = useState<ModeleRapport | null>(null);
  const [versions, setVersions] = useState<VersionConception[]>([]);
  const [courant, setCourant] = useState<ChargeMetriques | null>(null);
  const [bilanOuvert, setBilanOuvert] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const fenetre = useRef<{ f: Window; origine: string } | null>(null);
  const dernier = useRef<number | null>(null);
  const enAttente = useRef<ChargeMetriques | null>(null);
  const minuteur = useRef<number | null>(null);
  // Une seule ouverture par session Studio (le « prêt » d'échange revient toutes les 2 s).
  const ouverture = useRef(ouvertureInitiale());
  const delais = useRef<number[]>([]);
  const [studioAncien, setStudioAncien] = useState(false);

  // Session Studio de cette ouverture (projet v2 = parcelle réelle ; le reste passe par conception.ouvrir).
  const studio = useMemo((): { demande: DemandeStudioIntegre | null; erreur: string | null; charge: ChargeOuvrir | null } => {
    if (!demande) return { demande: null, erreur: null, charge: null };
    const c = demande.conception;
    if (!c.parcelle) return { demande: null, erreur: 'Le contour de la parcelle manque : relancez la mission de conception.', charge: null };
    const sessionId = crypto.randomUUID();
    const conversationId = conversationConception(c.id);
    const parcelles = parcellesConception(c);
    const insee = inseeConception(c.idu);
    const page = new URL(window.location.href); page.hash = '';
    const construit = projetConception(c, sessionId, window.location.origin, page.href);
    if (!construit.ok) return { demande: null, erreur: `Ouverture de l’Atelier impossible : ${construit.erreur}.`, charge: null };
    const url = new URL(adresseStudioIntegre(urlStudio(), projetIdChat(conversationId), sessionId, null));
    url.searchParams.set('mzconception', c.id);
    const charge: ChargeOuvrir = {
      conception_id: c.id, parcelle: c.parcelle, regles: c.regles, programme: c.programme, plan_source: demande.voie,
      ...(demande.planUrl ? { plan_url: demande.planUrl } : {}), ...(demande.modeleUrl ? { modele_url: demande.modeleUrl } : {}),
    };
    return {
      erreur: null, charge,
      demande: {
        cle: demande.cle, url: url.href, sessionId, projet: construit.projet,
        relief: { etat: 'differe', promesse: reliefAvecDelai(parcelles, insee), relancer: () => reliefAvecDelai(parcelles, insee) },
        implantation: null, imagesNonEnvoyees: 0,
      },
    };
  }, [demande]);

  // Hypothèses du bilan : rapport de la prospection d'origine.
  useEffect(() => {
    setRapport(null); setVersions([]); setCourant(null); setMessage(null); dernier.current = null; fenetre.current = null;
    ouverture.current = ouvertureInitiale(); setStudioAncien(false);
    delais.current.forEach((t) => window.clearTimeout(t)); delais.current = [];
    if (!demande) return;
    let vivant = true;
    void (async () => {
      try {
        const [origine, vs] = await Promise.all([lireMissionOrigine(demande.conception.mission_origine_id), listerVersions(demande.conception.id)]);
        if (!vivant) return;
        setRapport(origine ? construireModeleRapport(origine, origine.rapport_brut) : null);
        setVersions(vs);
      } catch (e) { if (vivant) setMessage(e instanceof Error ? e.message : 'Lecture impossible.'); }
    })();
    return () => { vivant = false; };
  }, [demande]);

  const poster = useCallback((msg: unknown) => {
    const cible = fenetre.current;
    if (cible) cible.f.postMessage(msg, cible.origine);
  }, []);

  const envoyerOuvrir = useCallback(() => {
    if (studio.charge && studio.demande) poster(creerMessageConception('conception.ouvrir', studio.demande.sessionId, studio.charge));
  }, [poster, studio]);

  const jeuEtSurface = useCallback(() => {
    const c = demande?.conception;
    const terrain = rapport?.terrains.find((t) => t.idu === c?.idu) ?? null;
    return { terrain, surface: c?.parcelle?.surface_m2 ?? terrain?.surface_m2 ?? null };
  }, [demande, rapport]);

  const enregistrer = useCallback(async (charge: ChargeMetriques & { modele: Record<string, unknown>; origine: 'generation' | 'modification_clic' | 'modification_texte' | 'plan_relu' }) => {
    if (!demande || !studio.demande) return;
    setEnregistrement(true); setMessage(null);
    const { terrain, surface } = jeuEtSurface();
    try {
      const e = entreesConception(rapport, terrain, charge.metriques, demande.conception.regles, surface);
      const v = await enregistrerVersion({
        conception: demande.conception, origine: charge.origine, resume: charge.resume || 'Version enregistrée depuis l’Atelier 3D',
        metriques: charge.metriques, conformite: charge.conformite, bilan: bilanVersion(e).bilan, modele: charge.modele,
      });
      setVersions((vs) => [v, ...vs]);
      setMessage(`Version ${v.n} enregistrée.`);
      useAgentUi.getState().signalerChangement();
      poster(creerMessageConception('conception.enregistre', studio.demande.sessionId, { conception_id: demande.conception.id, version_locale: charge.version_locale, ok: true, n: v.n }));
    } catch (err) {
      const texte = err instanceof Error ? err.message : 'Enregistrement impossible.';
      setMessage(texte);
      poster(creerMessageConception('conception.enregistre', studio.demande.sessionId, { conception_id: demande.conception.id, version_locale: charge.version_locale, ok: false, erreur: texte }));
    } finally { setEnregistrement(false); }
  }, [demande, studio, rapport, jeuEtSurface, poster]);
  const enregistrerRef = useRef(enregistrer);
  enregistrerRef.current = enregistrer;
  const ouvrirRef = useRef(envoyerOuvrir);
  ouvrirRef.current = envoyerOuvrir;

  const evenement = useCallback((ev: EvenementOuverture) => {
    const { etat, envoyer } = transitionOuverture(ouverture.current, ev);
    ouverture.current = etat;
    setStudioAncien(etat.studioAncien);
    if (envoyer) ouvrirRef.current();
  }, []);

  const surCadrePret = useCallback((f: Window, origine: string) => {
    fenetre.current = { f, origine };
    if (ouverture.current.cadrePret) return; // « prêt » répété : rien à renvoyer
    evenement('cadre_pret');
    delais.current.push(
      window.setTimeout(() => evenement('delai_envoi'), DELAI_ENVOI_MS),
      window.setTimeout(() => evenement('delai_ancien'), DELAI_STUDIO_ANCIEN_MS),
    );
  }, [evenement]);
  useEffect(() => () => { delais.current.forEach((t) => window.clearTimeout(t)); delais.current = []; }, []);

  // Messages du Studio : origine exacte + session de cette ouverture, forme validée.
  useEffect(() => {
    if (!studio.demande) return;
    const origine = new URL(studio.demande.url).origin;
    const sessionId = studio.demande.sessionId;
    const conceptionId = demande?.conception.id;
    const surMessage = (evt: MessageEvent) => {
      // Origine exacte ET fenêtre du cadre (connue au premier « prêt ») ET session de cette ouverture.
      if (evt.origin !== origine || !fenetre.current || evt.source !== fenetre.current.f) return;
      const lu = lireMessageConception(evt.data);
      if (!lu.ok || lu.message.sessionId !== sessionId) return;
      const m = lu.message;
      if (m.canal === 'conception.pret') { evenement('conception_pret'); return; }
      if (m.canal === 'conception.metriques' && m.charge.conception_id === conceptionId) {
        evenement('metriques');
        // Débit limité (~1/s) : la dernière charge reçue est toujours appliquée.
        enAttente.current = m.charge;
        const appliquer = () => { minuteur.current = null; dernier.current = Date.now(); if (enAttente.current) setCourant(enAttente.current); enAttente.current = null; };
        if (peutTraiter(dernier.current, Date.now())) appliquer();
        else if (minuteur.current == null) minuteur.current = window.setTimeout(appliquer, 1000 - (Date.now() - (dernier.current ?? 0)));
        return;
      }
      if (m.canal === 'conception.enregistrer' && m.charge.conception_id === conceptionId) {
        setCourant(m.charge);
        void enregistrerRef.current(m.charge);
      }
    };
    window.addEventListener('message', surMessage);
    return () => { window.removeEventListener('message', surMessage); if (minuteur.current != null) window.clearTimeout(minuteur.current); minuteur.current = null; };
  }, [studio.demande, demande, evenement]);

  if (!demande) return null;
  if (studio.erreur) {
    return ouvert ? (
      <div className="mzag mzcp-erreur" role="alertdialog">
        <p className="mzag-alerte">{studio.erreur}</p>
        <button type="button" className="mzag-btn" onClick={() => useAtelierConception.getState().fermer()}>Fermer</button>
      </div>
    ) : null;
  }

  const { terrain, surface } = jeuEtSurface();
  return (
    <>
      <StudioIntegre
        demande={studio.demande}
        ouvert={ouvert}
        onFermer={(vers) => {
          if (vers === 'bilan') { setBilanOuvert(true); return; }
          useAtelierConception.getState().fermer();
          useAgentUi.getState().ouvrir('conception');
        }}
        onCadrePret={surCadrePret}
      />
      {ouvert && (
        <BilanVivant
          conception={demande.conception}
          voie={demande.voie}
          rapport={rapport}
          terrain={terrain}
          surface={surface}
          courant={courant}
          versions={versions}
          ouvert={bilanOuvert}
          onBasculer={() => setBilanOuvert((x) => !x)}
          enregistrement={enregistrement}
          message={message}
          studioAncien={studioAncien}
          onEnregistrer={() => {
            if (!studio.demande) return;
            setMessage('Demande d’enregistrement envoyée à l’Atelier…');
            poster(creerMessageConception('conception.demander_enregistrement', studio.demande.sessionId, { conception_id: demande.conception.id }));
          }}
        />
      )}
    </>
  );
}
