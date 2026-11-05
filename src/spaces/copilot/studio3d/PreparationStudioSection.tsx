// src/spaces/copilot/studio3d/PreparationStudioSection.tsx
// =============================================================================
// LOT E1 — Carte « 3D préparée par Mimmo » du Dossier 3D.
//
// Quand le copilote a préparé la 3D d'une conception (outil studio_preparer_3d),
// la carte rappelle les chiffres du moteur (indicatifs) et les vérifications
// telles qu'annoncées, et ouvre le Studio en UN clic par le parcours existant
// « Voir en 3D » (MimmozIAPage.voirEn3D via onOpenStudio) : la parcelle de la
// conception tient lieu de parcelle confirmée, les bâtiments partent dans le
// projet v2 (`batiments`) ou, s'il n'y en a qu'un, avec leur pose.
// Elle affiche aussi les rendus de la conversation (statut RÉEL de studio_jobs,
// suivi en direct, liens du résultat) quand Mimmo en a devisé ou lancé un et que
// le panneau Film / visite 360° n'est pas affiché.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Box } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { messageErreur } from '@/components/ui/messageErreur';
import {
  LIBELLES_TYPE, lienVisite, listerTravaux, phraseSuivi, suivreTravail, urlSigneeRendu, estActif, type TravailStudio,
} from '@/lib/studio/travaux';
import type { JarvisDraft } from './jarvisDraft';
import type { ConfirmedTerrain } from './terrainCadastre';
import type { IssueOuvertureStudio } from './JarvisDraftPanel';
import {
  dernierePreparation, LIBELLES_VERDICT, lignesCarte, lirePreparationStockee, ouverturePreparation, renduDemande, type MessageOutils,
} from './preparationStudio';
import './VolumeParcelle.css';

type OuvrirStudio = (draft: JarvisDraft, conversationId: string, terrain?: ConfirmedTerrain & { adresse?: string | null }) => Promise<IssueOuvertureStudio>;

export function PreparationStudioSection({ messages, conversationId, onOpenStudio, suiviRendus }: {
  messages: readonly MessageOutils[];
  conversationId: string | null;
  onOpenStudio?: OuvrirStudio;
  /** Afficher le suivi des rendus (faux quand le panneau Film / visite 360° est déjà affiché). */
  suiviRendus: boolean;
}) {
  const ref = useMemo(() => dernierePreparation(messages), [messages]);
  const rendus = useMemo(() => suiviRendus && renduDemande(messages), [messages, suiviRendus]);
  const [ouverture, setOuverture] = useState(false);
  const [notice, setNotice] = useState('');

  const ouvrir = async () => {
    if (!ref || !conversationId || !onOpenStudio || ouverture) return;
    setOuverture(true); setNotice('');
    try {
      const { data, error } = await supabase.from('studio_preparations').select('id,idu,entree,volume').eq('id', ref.preparationId).maybeSingle();
      if (error) throw new Error('La 3D préparée n’a pas pu être relue. Réessayez.');
      const p = lirePreparationStockee(data);
      if (!p) throw new Error('La 3D préparée est introuvable ou illisible : demandez à Mimmo de la préparer à nouveau.');
      const o = ouverturePreparation(p);
      if (!o.ok) throw new Error(o.erreur);
      const issue = await onOpenStudio(o.fiche, conversationId, o.terrain);
      if (issue === 'parcelle-requise') setNotice('Le Studio demande de confirmer la parcelle.');
    } catch (e) {
      setNotice(messageErreur(e, 'Ouverture de Studio impossible.'));
    } finally { setOuverture(false); }
  };

  if (!ref && !rendus) return null;
  return <section className="mzia-volume" aria-label="3D préparée par Mimmo">
    {ref && <>
      <header className="mzia-volume__tete">
        <h3><span className="mzia-volume__ref">3D préparée par Mimmo</span> <span className="mzia-volume__zone">{ref.idu}{ref.commune ? ` · ${ref.commune}` : ''}</span></h3>
      </header>
      <p>Volume d’étude calculé par le moteur du Dossier 3D à partir de la fiche de conception (parcelle cadastrale, règles PLU enregistrées, programme). Valeurs indicatives, conformité à vérifier par un professionnel.</p>
      <ul>{lignesCarte(ref).map(l => <li key={l}>{l}</li>)}</ul>
      {ref.controles.length > 0 && <details>
        <summary>Vérifications ({ref.controles.length})</summary>
        <ul>{ref.controles.map(c => <li key={c.libelle}><strong>{c.libelle}</strong> — {LIBELLES_VERDICT[c.verdict]}{c.explication ? ` : ${c.explication}` : ''}</li>)}</ul>
      </details>}
      {ref.alertes.map(a => <p key={a} role="status">{a}</p>)}
      {conversationId && onOpenStudio && <button type="button" className="jarvis-dossier__launch" disabled={ouverture} onClick={() => void ouvrir()}>
        <Box size={16} /> {ouverture ? 'Ouverture de Studio…' : 'Ouvrir la 3D préparée'} <ArrowUpRight size={17} />
      </button>}
      {notice && <p role="alert">{notice}</p>}
    </>}
    {rendus && conversationId && <SuiviRendus conversationId={conversationId} />}
  </section>;
}

/** Rendus de la conversation : statut tel qu'écrit par la machine de rendu, liens à la fin. */
function SuiviRendus({ conversationId }: { conversationId: string }) {
  const [travaux, setTravaux] = useState<TravailStudio[] | null>(null);
  const [liens, setLiens] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let actif = true;
    const arrets: (() => void)[] = [];
    void listerTravaux(conversationId).then(r => {
      if (!actif || !r.disponible) return;
      setTravaux(r.valeur);
      for (const t of r.valeur.filter(x => estActif(x.statut))) {
        arrets.push(suivreTravail(t.id, maj => setTravaux(l => (l ?? []).map(x => (x.id === maj.id ? maj : x)))));
      }
    }).catch(() => { if (actif) setTravaux([]); });
    return () => { actif = false; arrets.forEach(a => a()); };
  }, [conversationId]);
  useEffect(() => {
    for (const t of travaux ?? []) {
      if (t.statut !== 'termine' || !t.resultat || liens[t.id]) continue;
      const r = t.resultat as unknown as Record<string, unknown>;
      const chemins = t.type === 'film' ? [r.video_path] : t.type === 'image' ? (Array.isArray(r.images) ? r.images.map(i => (i as Record<string, unknown>).jpeg_path) : [r.image_path]) : [];
      if (t.type === 'visite360' && typeof r.visite_id === 'string') { setLiens(l => ({ ...l, [t.id]: [lienVisite(r.visite_id as string, window.location.origin)] })); continue; }
      void Promise.all(chemins.filter((c): c is string => typeof c === 'string').map(c => urlSigneeRendu(c).catch(() => null)))
        .then(urls => setLiens(l => ({ ...l, [t.id]: urls.filter((u): u is string => !!u) })));
    }
  }, [travaux, liens]);
  if (!travaux?.length) return null;
  return <div aria-label="Rendus demandés à Mimmo">
    <h4>Rendus</h4>
    <ul>{travaux.map(t => <li key={t.id}>
      <strong>{LIBELLES_TYPE[t.type]}</strong> — {phraseSuivi(t)}
      {(liens[t.id] ?? []).map((u, i) => <span key={u}> <a href={u} target="_blank" rel="noreferrer">{t.type === 'visite360' ? 'Ouvrir la visite' : `Voir le résultat${(liens[t.id]?.length ?? 0) > 1 ? ` ${i + 1}` : ''}`}</a></span>)}
    </li>)}</ul>
  </div>;
}
