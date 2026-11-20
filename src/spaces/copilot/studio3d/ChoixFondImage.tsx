// src/spaces/copilot/studio3d/ChoixFondImage.tsx
// =============================================================================
// LOT P2 (11/11/2026) — carte « Fond de l'image » sous le devis d'une image (contrat agents-1111/CONTRAT-PHOTO-RUE.md).
//
// Trois choix, selon la couverture vérifiée par le serveur au moment du devis :
//   · « Photo de la rue (Panoramax / IGN) » — seulement s'il existe des photos sous Licence Ouverte à 60 m au plus ;
//   · « Votre photo du trottoir » — consentement, consignes, EXIF, point de vue sur le plan, envoi du fichier d'origine ;
//   · « Étude seule ».
// Un choix envoie un message au chat (bloc relu par le serveur) : Mimmo établit le NOUVEAU devis, l'utilisateur
// donne son accord ensuite. Rien n'est lancé depuis cette carte. Logique pure : choixFond.ts.
// =============================================================================
import { useMemo, useState } from 'react';
import { Image as IconeImage, RefreshCw } from 'lucide-react';
import { useCopilotStore } from '../store/copilotStore';
import { demandeDepassee, type DemandeBrief } from './briefCreatif';
import { lireDevisFond, messageFond, messageVues, tuilesFond } from './choixFond';
// VIS-04 — vues du catalogue cochables sous le devis (pack plaquette pré-coché, vues à venir grisées « bientôt »).
import { catalogueVues, estVueCatalogue, LIBELLES_GROUPE_VUE, MAX_VUES_PAR_IMAGE, pronosticVues, VUES_DISPONIBLES, vueCochable, vuesPreCochees, type GroupeVue, type VueCatalogue } from '@/lib/studio/catalogueVues';
// VIS-10 — pronostic des vues « sous condition » renvoyé par le serveur avec le devis (`data.pronostic_vues`).
import { lirePronosticDevis } from './choixFond';
import { CLES_FOND } from '@/lib/studio/fondImage';
import { champsBriefDeLaConversation } from '@/spaces/promoteur/shared/briefProjet.store';
// VIS-18b : le fond choisi ici est aussi MÉMORISÉ dans le parcours (étape 6 « Vues & ambiance »), et inversement.
import { majMemoireParcours, patcherInstantaneFond } from './parcours.store';
import { fondDuChoix } from './reglagesParcoursLogique';
import type { OptionsFond } from '@/lib/studio/fondImage';

/** Options du devis présenté (vues, fond) — lues dans la sortie de l'outil, jamais devinées. */
function optionsDuDevis(call: { output?: unknown }): Record<string, unknown> | null {
  const o = call.output as { data?: { options?: unknown } } | undefined;
  const opts = o?.data?.options;
  return opts && typeof opts === 'object' && !Array.isArray(opts) ? opts as Record<string, unknown> : null;
}
import { PhotoClientRue } from './PhotoClientRue';
import { demanderCouverturePhotoRue, LIBELLES_FOND, type PhotoClientOption } from '@/lib/studio/travaux';
import { phraseCouverture, type CouverturePhotoRue } from '@/lib/studio/couverturePhotoRue';
import './CarteBriefCreatif.css';

export function ChoixFondImage({ call, demande, messageId, onSend }: {
  call: { name: string; status?: string; output?: unknown };
  demande: DemandeBrief;
  messageId: string;
  onSend?: (texte: string) => void;
}) {
  const devis = useMemo(() => lireDevisFond(call), [call]);
  const messages = useCopilotStore((s) => s.messages);
  const depasse = useMemo(() => demandeDepassee(messages, messageId), [messages, messageId]);
  const [photoOuverte, setPhotoOuverte] = useState(false);
  const [couverture, setCouverture] = useState<CouverturePhotoRue | null>(null);
  const [verification, setVerification] = useState<{ enCours: boolean; erreur: string }>({ enCours: false, erreur: '' });
  const [envoye, setEnvoye] = useState<string | null>(null);
  const conversationId = useCopilotStore((s) => s.currentConversationId);
  const optionsDevis = useMemo(() => optionsDuDevis(call), [call]);
  const vuesDevis = useMemo<VueCatalogue[]>(() => {
    const v = Array.isArray(optionsDevis?.vues) ? (optionsDevis!.vues as unknown[]).filter(estVueCatalogue) : [];
    return v.length ? v : vuesPreCochees();
  }, [optionsDevis]);
  const [vues, setVues] = useState<VueCatalogue[] | null>(null);
  const pronosticDevis = useMemo(() => lirePronosticDevis(call), [call]);
  if (!devis) return null;
  const vuesCochees = vues ?? vuesDevis;
  // VIS-10 : pronostic du serveur pour les vues du devis ; vues cochées depuis : « selon le projet » (le serveur tranchera au nouveau devis).
  const pronostic = pronosticVues(vuesCochees, null).map(p => pronosticDevis.find(d => d.vue === p.vue) ?? p);
  const basculerVue = (v: VueCatalogue) => setVues(() => {
    const avec = vuesCochees.includes(v);
    if (avec && vuesCochees.length === 1) return vuesCochees;
    if (!avec && vuesCochees.length >= MAX_VUES_PAR_IMAGE) return vuesCochees;
    return VUES_DISPONIBLES.filter(x => (x === v ? !avec : vuesCochees.includes(x)));
  });
  const vuesChangees = vues !== null && vues.join(',') !== vuesDevis.join(',');
  const envoyerVues = () => {
    if (!onSend || !vues) return;
    let projet: Record<string, unknown> | null = null;
    try { projet = conversationId ? (champsBriefDeLaConversation(conversationId, { reglages: { vues } })?.champs as Record<string, unknown> | undefined) ?? null : null; } catch { projet = null; }
    const fondActuel = optionsDevis && optionsDevis.fond && optionsDevis.fond !== 'etude'
      ? Object.fromEntries(Object.entries(optionsDevis).filter(([k]) => (CLES_FOND as readonly string[]).includes(k))) as Parameters<typeof messageVues>[2]
      : null;
    const texte = messageVues(demande, vues, fondActuel, { projet });
    if (!texte) return;
    onSend(texte);
    setEnvoye(`vues : ${vues.length}`);
  };
  const d = couverture ? { ...devis, couverture, raisonCouverture: null } : devis;
  if (depasse || envoye) {
    return (
      <section className="mz-ligne-habillage" aria-label="Fond de l’image">
        <IconeImage size={16} aria-hidden="true" />
        <p><strong>Fond de l’image</strong> · {envoye ?? LIBELLES_FOND[d.choisi]}</p>
      </section>
    );
  }
  const envoyer = (texte: string | null, libelle: string) => {
    if (!onSend || !texte) return;
    onSend(texte);
    setEnvoye(libelle);
  };
  const memoriser = (fond: OptionsFond) => {
    if (!conversationId || !onSend) return;
    majMemoireParcours(conversationId, { fond });
    patcherInstantaneFond(conversationId, fond);
  };
  const choisirRue = () => { memoriser(fondDuChoix('photo_rue')); envoyer(messageFond(demande, { fond: 'photo_rue' }), LIBELLES_FOND.photo_rue); };
  const choisirEtude = () => { memoriser(fondDuChoix('etude')); envoyer(messageFond(demande, { fond: 'etude' }), LIBELLES_FOND.etude); };
  const photoPrete = (photo: PhotoClientOption) => {
    setPhotoOuverte(false);
    memoriser(fondDuChoix('photo_client', photo));
    envoyer(messageFond(demande, { fond: 'photo_client', photo_client: photo }), LIBELLES_FOND.photo_client);
  };
  const verifier = async () => {
    if (!d.contour) return;
    setVerification({ enCours: true, erreur: '' });
    const r = await demanderCouverturePhotoRue(d.contour);
    if (r.ok) { setCouverture(r.couverture); setVerification({ enCours: false, erreur: '' }); }
    else setVerification({ enCours: false, erreur: r.raison });
  };
  const sansBrief = !demande.actuel;
  return (
    <section className="mz-brief mz-fond-image" aria-label="Fond de l’image">
      <header className="mz-fond-image__tete">
        <IconeImage size={16} aria-hidden="true" />
        <strong>Fond de l’image</strong>
        <span>· devis actuel : {LIBELLES_FOND[d.choisi]}</span>
      </header>
      {(['exterieur', 'privatif', 'interieur'] as GroupeVue[]).map(groupe => (
        <div key={groupe} className="mz-fond-image__tuiles" role="group" aria-label={`Vues — ${LIBELLES_GROUPE_VUE[groupe]}`}>
          <small style={{ width: '100%' }}>{groupe === 'exterieur' ? `Vues · ${LIBELLES_GROUPE_VUE[groupe]} (1 à ${String(MAX_VUES_PAR_IMAGE)})` : LIBELLES_GROUPE_VUE[groupe]}</small>
          {catalogueVues().filter(c => c.groupe === groupe).map(c => vueCochable(c)
            ? <button key={c.id} type="button" aria-pressed={vuesCochees.includes(c.id)} className={`mz-fond-image__tuile${vuesCochees.includes(c.id) ? ' is-choisi' : ''}`}
              title={c.condition ? `Produite ${c.condition} ; sinon refusée avec sa raison.` : undefined}
              disabled={!onSend || sansBrief} onClick={() => basculerVue(c.id)}><b>{c.libelle}</b>{c.statut === 'sous_condition' && <small>selon le projet</small>}</button>
            : <button key={c.id} type="button" className="mz-fond-image__tuile" disabled aria-disabled="true" title="Vue prévue, pas encore produite par la machine de rendu"
              style={{ opacity: 0.5 }}><b>{c.libelle}</b><small>bientôt</small></button>)}
        </div>))}
      {pronostic.length > 0 && <ul className="mz-fond-image__note" aria-label="Vues sous condition" style={{ margin: '0 0 0 16px', padding: 0 }}>
        {pronostic.map(p => <li key={p.vue}>{p.pronostic === 'probablement_refusee'
          ? <><b>{p.libelle}</b> : probablement refusée ({p.raison}).</>
          : <><b>{p.libelle}</b> : {p.raison}.</>}</li>)}
      </ul>}
      {vuesChangees && <button type="button" className="mz-fond-image__verifier" onClick={envoyerVues} disabled={!onSend || sansBrief}>
        Mettre à jour les vues du devis
      </button>}
      {d.couverture && <p className="mz-fond-image__note">{phraseCouverture(d.couverture)}</p>}
      {d.facade && <p className="mz-fond-image__note">Façade sur voie : {d.facade}.</p>}
      <div className="mz-fond-image__tuiles" role="group" aria-label="Choisir le fond de l’image">
        {tuilesFond(d).map((t) => (
          <button key={t.fond} type="button" className={`mz-fond-image__tuile${t.fond === d.choisi ? ' is-choisi' : ''}`}
            disabled={!t.actif || !onSend || sansBrief || t.fond === d.choisi}
            onClick={() => (t.fond === 'photo_rue' ? choisirRue() : t.fond === 'etude' ? choisirEtude() : setPhotoOuverte(true))}>
            <b>{t.libelle}</b><small>{t.detail}</small>
          </button>
        ))}
      </div>
      {!d.couverture && d.contour && <button type="button" className="mz-fond-image__verifier" onClick={() => void verifier()} disabled={verification.enCours}>
        <RefreshCw size={13} aria-hidden="true" /> {verification.enCours ? 'Vérification…' : 'Vérifier les photos de rue disponibles'}
      </button>}
      {verification.erreur && <p className="mz-fond-image__note" role="alert">{verification.erreur}</p>}
      {sansBrief && <p className="mz-fond-image__note">Pour changer le fond, écrivez-le à Mimmo (« image sur la photo de la rue »).</p>}
      <p className="mz-fond-image__note">Un choix demande un nouveau devis à Mimmo ; rien n’est lancé avant votre accord.</p>
      {photoOuverte && <PhotoClientRue contour={d.contour} onPret={photoPrete} onFermer={() => setPhotoOuverte(false)} />}
    </section>
  );
}
