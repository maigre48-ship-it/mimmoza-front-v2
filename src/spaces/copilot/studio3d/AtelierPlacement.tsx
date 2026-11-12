// src/spaces/copilot/studio3d/AtelierPlacement.tsx
// =============================================================================
// LOT P2 (11/11/2026) — « Ajuster le placement » sous une image livrée en image d'étude, statut `a_valider`
// (contrat agents-1111/CONTRAT-PHOTO-RUE.md, §3 et §4).
//
//   1. clic : l'atelier du Studio s'ouvre (même origine, /studio/?atelier=photomontage&travail=<id>) ;
//   2. le site lui envoie les adresses SIGNÉES (1 h) de la photo et du plan préparé (seau privé studio-rendus),
//      cible = origine exacte du Studio, jusqu'au retour ou à la fermeture de l'onglet ;
//   3. retour `mimmoza-calage-v1` filtré (origine, fenêtre ouverte ici, travail attendu, calage revalidé) ;
//   4. DEVIS affiché (options, 0 jeton aujourd'hui, durée) puis confirmation explicite → NOUVEAU travail
//      identique avec `calage_client` ; son suivi s'affiche ici même.
// LOT P5-SITE (12/11/2026) — effacement de l'existant : le masque PROPOSÉ (`atelier.masque_path`) est signé et
// envoyé avec la photo et le plan ; la zone corrigée (`mimmoza-masque-existant-v1`, avant le calage) est gardée
// jusqu'au calage, vérifiée (taille de la photo calée), déposée dans `studio-transfert/<uid>/<uuid>.png` AVANT
// l'insertion du travail, puis jointe en option `masque_existant` (l'id d'un travail est tiré par la base).
// Logique pure : src/lib/studio/atelierPhotomontage.ts, src/lib/studio/masqueExistant.ts. Aucune clé de service côté site.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2 } from 'lucide-react';
import {
  creerTravail, dureeEstimeeImage, lireFicheTravail, MENTION_MACHINE_RENDU, resumeOptions, retirerMasqueExistant,
  televerserMasqueExistant, urlSigneeRendu, validerOptions,
  type CalageClient, type FicheTravail, type OptionsImage, type ResultatImage, type TravailStudio,
} from '@/lib/studio/travaux';
import { masqueAccordeAuCalage, type MasqueRecu } from '@/lib/studio/masqueExistant';
import {
  DUREE_URL_ATELIER_S, examinerMessageCalage, ficheReprise, messageAtelier, optionsAvecCalage, urlAtelier,
} from '@/lib/studio/atelierPhotomontage';
import { urlStudio } from '@/lib/studioConfig';
import { CarteSuiviRendu } from './CarteSuiviRendu';

type Etape =
  | { etape: 'repos'; message?: string }
  | { etape: 'atelier'; recu: boolean }
  | { etape: 'devis'; calage: CalageClient; options: OptionsImage; masque: MasqueRecu | null; alerte?: string }
  | { etape: 'lancement'; calage: CalageClient; options: OptionsImage; masque: MasqueRecu | null }
  | { etape: 'lance'; jobId: string };

/** Envoi répété des adresses à l'atelier (il peut charger après notre premier message). */
const INTERVALLE_ENVOI_MS = 1000;

export function AtelierPlacement({ travail }: { travail: TravailStudio }) {
  const [etat, setEtat] = useState<Etape>({ etape: 'repos' });
  const arreter = useRef<(() => void) | null>(null);
  const photomontage = (travail.resultat as ResultatImage | null)?.photomontage ?? null;
  const atelier = photomontage?.atelier ?? null;

  useEffect(() => () => { arreter.current?.(); }, []);

  const ouvrir = async () => {
    if (!atelier) return;
    arreter.current?.();
    let url: string;
    try { url = urlAtelier(urlStudio(), travail.id); } catch { setEtat({ etape: 'repos', message: 'Adresse du Studio introuvable : l’atelier ne peut pas s’ouvrir.' }); return; }
    // Fenêtre ouverte dans le geste de l'utilisateur (avant toute attente), sinon le navigateur la bloque.
    const fenetre = window.open(url, '_blank');
    if (!fenetre) { setEtat({ etape: 'repos', message: 'Le navigateur a bloqué l’ouverture de l’atelier : autorisez les fenêtres pour Mimmoza, puis réessayez.' }); return; }
    try { fenetre.opener = null; } catch { /* sans effet sur l'échange : l'atelier répond à event.source */ }
    setEtat({ etape: 'atelier', recu: false });
    let photoUrl: string, planUrl: string, masqueUrl: string | null;
    try {
      [photoUrl, planUrl, masqueUrl] = await Promise.all([
        urlSigneeRendu(atelier.photo_path, DUREE_URL_ATELIER_S), urlSigneeRendu(atelier.plan_path, DUREE_URL_ATELIER_S),
        atelier.masque_path ? urlSigneeRendu(atelier.masque_path, DUREE_URL_ATELIER_S) : Promise.resolve(null),
      ]);
    } catch {
      setEtat({ etape: 'repos', message: 'La photo, le plan préparé ou la zone à effacer ne sont pas accessibles pour l’instant. Réessayez dans un instant.' });
      return;
    }
    const origine = new URL(url).origin;
    const message = messageAtelier(travail.id, crypto.randomUUID(), photoUrl, planUrl, Date.now(), masqueUrl);
    // Zone à effacer corrigée : reçue AVANT le calage, gardée jusqu'à lui (la dernière reçue l'emporte).
    let masque: MasqueRecu | null = null;
    // Répété jusqu'à l'accusé de réception de l'atelier ; ensuite, seule la fermeture de l'onglet est surveillée.
    let recu = false;
    const envoyer = () => {
      if (fenetre.closed) { fin(); setEtat((e) => (e.etape === 'atelier' ? { etape: 'repos', message: 'Atelier fermé sans placement validé.' } : e)); return; }
      if (recu) return;
      try { fenetre.postMessage(message, origine); } catch { /* onglet pas encore chargé */ }
    };
    const surMessage = (evt: MessageEvent) => {
      const d = examinerMessageCalage({ origin: evt.origin, data: evt.data }, origine, evt.source === fenetre, travail.id);
      if (d.type === 'ignore') return;
      if (d.type === 'recu') { recu = true; setEtat((e) => (e.etape === 'atelier' ? { etape: 'atelier', recu: true } : e)); return; }
      if (d.type === 'masque') { masque = d.masque; return; }
      fin();
      if (d.type === 'refus') { setEtat({ etape: 'repos', message: `Correction refusée : ${d.raison}` }); return; }
      if (masque) {
        const accord = masqueAccordeAuCalage(masque, d.calage);
        if (!accord.ok) { setEtat({ etape: 'repos', message: accord.erreur }); return; }
      }
      // Le devis est calculé sans la zone (déposée seulement au lancement confirmé) : mêmes options sinon.
      const o = optionsAvecCalage(travail.options, d.calage, photomontage);
      if (!o.ok) { setEtat({ etape: 'repos', message: o.erreur }); return; }
      setEtat({ etape: 'devis', calage: d.calage, options: o.valeur, masque });
    };
    const minuterie = window.setInterval(envoyer, INTERVALLE_ENVOI_MS);
    window.addEventListener('message', surMessage);
    envoyer();
    function fin() { window.clearInterval(minuterie); window.removeEventListener('message', surMessage); arreter.current = null; }
    arreter.current = fin;
  };

  const lancer = async () => {
    if (etat.etape !== 'devis') return;
    const { calage, options, masque } = etat;
    setEtat({ etape: 'lancement', calage, options, masque });
    let deposee: string | null = null;
    try {
      const lu = await lireFicheTravail(travail.id);
      const fiche = lu ? ficheReprise(lu.fiche, travail.id) : null;
      if (!lu || !fiche?.ok) { setEtat({ etape: 'repos', message: fiche && !fiche.ok ? fiche.erreur : 'L’image d’origine n’est plus accessible.' }); return; }
      const conversation = lu.conversation_id ?? travail.conversation_id;
      if (!conversation) { setEtat({ etape: 'repos', message: 'Conversation de l’image introuvable.' }); return; }
      let optionsFinales: OptionsImage = options;
      if (masque) {
        // Dépôt AVANT l'insertion : le travail n'existe jamais sans sa zone à effacer.
        const option = await televerserMasqueExistant(masque.octets);
        deposee = option.chemin;
        const v = validerOptions('image', { ...options, masque_existant: option });
        if (!v.ok) throw new Error(v.erreur);
        optionsFinales = v.valeur as OptionsImage;
      }
      const r = await creerTravail({ conversation_id: conversation, type: 'image', fiche: fiche.valeur as unknown as FicheTravail, options: optionsFinales });
      if (!r.disponible) {
        if (deposee) void retirerMasqueExistant(deposee);
        setEtat({ etape: 'repos', message: 'Les rendus ne sont pas disponibles pour l’instant.' });
        return;
      }
      setEtat({ etape: 'lance', jobId: r.valeur.id });
    } catch (e) {
      if (deposee) void retirerMasqueExistant(deposee);
      const texte = e instanceof Error ? e.message : 'Le lancement n’a pas abouti.';
      // Base pas encore à jour (option `masque_existant` inconnue) : on le dit, et l'on propose de lancer sans la zone.
      if (masque && /bientôt disponible|ne sont pas acceptées/.test(texte)) {
        setEtat({ etape: 'devis', calage, options, masque, alerte: 'La zone à effacer corrigée n’est pas encore acceptée par le serveur. Vous pouvez lancer sans elle (zone calculée automatiquement) ou réessayer plus tard.' });
        return;
      }
      setEtat({ etape: 'repos', message: texte });
    }
  };

  if (!atelier) return null;
  if (etat.etape === 'lance') {
    return <CarteSuiviRendu indice={{ jobId: etat.jobId, origine: 'lance', type: 'image', statut: 'en_attente', machine: null, positionFile: null }} />;
  }
  if (etat.etape === 'devis' || etat.etape === 'lancement') {
    const n = etat.calage.correspondances.length;
    return (
      <div className="mz-suivi-rendu__devis" role="group" aria-label="Devis de la nouvelle image">
        <p><strong>Nouvelle image avec votre placement</strong> ({n} point{n > 1 ? 's' : ''} de correspondance validé{n > 1 ? 's' : ''})</p>
        <ul>
          <li>Rendu : image du projet — {resumeOptions('image', etat.options)}</li>
          {etat.masque && <li>Zone du bâtiment existant à effacer : corrigée par vous dans l’atelier (jointe à la demande).</li>}
          <li>Jetons : 0 — les rendus ne sont pas facturés aujourd’hui.</li>
          <li>Temps de calcul : {dureeEstimeeImage(etat.options.vues.length, etat.options.qualite)} une fois le rendu démarré.</li>
          <li>{MENTION_MACHINE_RENDU}</li>
        </ul>
        {etat.etape === 'devis' && etat.alerte && <p className="mz-suivi-rendu__alerte" role="alert">{etat.alerte}</p>}
        <div className="mz-suivi-rendu__actions">
          {etat.etape === 'devis' && etat.alerte && etat.masque && (
            <button type="button" className="mz-suivi-rendu__bouton is-leger" onClick={() => setEtat({ etape: 'devis', calage: etat.calage, options: etat.options, masque: null })}>Lancer sans la zone corrigée</button>
          )}
          <button type="button" className="mz-suivi-rendu__bouton" disabled={etat.etape === 'lancement'} onClick={() => void lancer()}>
            {etat.etape === 'lancement' ? <><Loader2 size={14} className="mz-suivi-rendu__tourne" aria-hidden="true" /> Lancement…</> : 'Lancer la nouvelle image'}
          </button>
          <button type="button" className="mz-suivi-rendu__bouton is-leger" disabled={etat.etape === 'lancement'} onClick={() => setEtat({ etape: 'repos' })}>Annuler</button>
        </div>
      </div>
    );
  }
  return (
    <div className="mz-suivi-rendu__atelier">
      <button type="button" className="mz-suivi-rendu__bouton" onClick={() => void ouvrir()} disabled={etat.etape === 'atelier'}>
        <Crosshair size={14} aria-hidden="true" /> {etat.etape === 'atelier' ? (etat.recu ? 'Atelier ouvert : validez le placement…' : 'Ouverture de l’atelier…') : atelier.masque_path ? 'Corriger dans l’atelier' : 'Ajuster le placement'}
      </button>
      <p className="mz-suivi-rendu__detail">{atelier.masque_path
        ? 'L’atelier s’ouvre dans un nouvel onglet : vérifiez le placement (2 à 12 points de la photo et leur place sur le plan) et corrigez au pinceau la zone du bâtiment existant à effacer (en rouge). Une nouvelle image sera proposée, avec son devis.'
        : 'L’atelier s’ouvre dans un nouvel onglet : cliquez 2 à 12 points de la photo et leur place sur le plan. Une nouvelle image sera proposée, avec son devis.'}</p>
      {etat.etape === 'repos' && etat.message && <p className="mz-suivi-rendu__alerte" role="alert">{etat.message}</p>}
    </div>
  );
}
