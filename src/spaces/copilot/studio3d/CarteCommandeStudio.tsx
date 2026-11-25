// src/spaces/copilot/studio3d/CarteCommandeStudio.tsx
// =============================================================================
// VIS-45 — carte d'une commande du chat Mimmoza au Studio (outil `studio_commander`, bouton « Plans » de la carte du
// bâtiment). Elle ENVOIE la commande une seule fois (pont pontCommandesSite.ts), puis montre le compte rendu du Studio :
// « en cours », « en attente : s'exécutera à l'ouverture du Studio » (+ « Ouvrir le Studio »), fait / échec, et pour les
// plans d'architecte les liens de téléchargement (PDF, DXF, IFC, SVG) et le tableau des surfaces.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import { doitEnvoyer, dejaEnvoyee, envoyerCommandeStudio, estTraceStudio, useCommandesStudio, type CarteCommande, type LienFichier, type SuiviCommande } from './pontCommandesSite';
import { lienSigne } from './usePontCommandesStudio';
import { EVENEMENT_PARCOURS_STUDIO, type DemandeParcoursStudio } from './parcours.store';
import { projetIdChat } from './projetChat';
import type { SurfacesPlans } from '@/spaces/promoteur/shared/echangeStudio/pontCommandesStudio';
import './CarteCommandeStudio.css';

const nf = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

function TableauSurfaces({ s }: { s: SurfacesPlans }) {
  const lignes: [string, number | null][] = [['Surface habitable', s.surfaceHabitableM2], ['Surface de plancher (SDP)', s.surfacePlancherM2], ['Emprise au sol', s.empriseM2]];
  return (
    <table className="mz-cmd__surfaces" aria-label="Tableau des surfaces">
      <tbody>
        {lignes.filter(([, v]) => v !== null).map(([l, v]) => <tr key={l}><th scope="row">{l}</th><td>{nf(v!)} m²</td></tr>)}
        {s.lignes.map((l) => <tr key={l.libelle} className="is-detail"><th scope="row">{l.libelle}</th><td>{nf(l.m2)} m²</td></tr>)}
      </tbody>
    </table>
  );
}

function BoutonFichier({ f }: { f: LienFichier }) {
  const [url, setUrl] = useState<string | null>(f.url);
  const [note, setNote] = useState<string | null>(f.note);
  const ouvrir = async () => {
    if (url) return;
    if (!f.chemin) return;
    const u = await lienSigne(f.chemin);
    if (u) { setUrl(u); window.open(u, '_blank', 'noopener'); } else setNote('lien expiré : redemandez les plans');
  };
  return (
    <span className="mz-cmd__fichier">
      {url
        ? <a className="mz-cmd__btn" href={url} download={f.nom} target="_blank" rel="noopener">{f.format.toUpperCase()} — {f.nom}</a>
        : <button type="button" className="mz-cmd__btn" disabled={!f.chemin} onClick={() => void ouvrir()}>{f.format.toUpperCase()} — {f.nom}</button>}
      {note && <small className="mz-cmd__note">{note}</small>}
    </span>
  );
}

/** Compte rendu (direct ou relu en base) : phrase, fichiers, surfaces. */
export function ResultatCommandeStudio({ suivi, onOuvrirStudio }: { suivi: SuiviCommande; onOuvrirStudio?: () => void }) {
  const classe = suivi.etat === 'fait' ? 'is-ok' : suivi.etat === 'echec' || suivi.etat === 'refus' ? 'is-ko' : 'is-wait';
  return (
    <div className={`mz-cmd__resultat ${classe}`} role="status">
      <p className="mz-cmd__phrase"><strong>{suivi.libelle}</strong> — {suivi.message}</p>
      {suivi.etat === 'attente' && onOuvrirStudio && <button type="button" className="mz-cmd__btn is-actif" onClick={onOuvrirStudio}>Ouvrir le Studio</button>}
      {suivi.fichiers.length > 0 && <div className="mz-cmd__fichiers">{suivi.fichiers.map((f) => <BoutonFichier key={f.nom} f={f} />)}</div>}
      {suivi.surfaces && <TableauSurfaces s={suivi.surfaces} />}
    </div>
  );
}

/** Suivi relu en base (trace copilot_action_runs) pour un appel donné. */
export function suiviDeTrace(runs: readonly { messageId: string; message?: string; params: Record<string, unknown>; outcome: string }[], appelId: string): SuiviCommande | null {
  const r = [...runs].reverse().find((x) => estTraceStudio(x) && x.params.appelId === appelId && x.params.type === 'compte-rendu');
  if (!r) return null;
  const p = r.params;
  const fichiers = Array.isArray(p.fichiers) ? (p.fichiers as { nom: string; format: string; chemin: string | null; note: string | null }[]).map((f) => ({ ...f, url: null })) : [];
  const etat = p.statut === 'fait' ? 'fait' : p.statut === 'confirmation' ? 'confirmation' : r.outcome === 'refused' ? 'refus' : 'echec';
  return { requeteId: String(p.requeteId ?? ''), appelId, libelle: String(p.libelle ?? ''), etat, message: r.message ?? '', fichiers, surfaces: (p.surfaces as SurfacesPlans) ?? null };
}

/** Ouvre le Studio de la conversation (même parcours que l'étape « Bâtiment » du chat) : les commandes en attente y partent. */
export function ouvrirLeStudio(etape: DemandeParcoursStudio['etape'] = 'batiment', sous = 'batiment', repondre: (m: string | null) => void = () => undefined): void {
  const demande: DemandeParcoursStudio = { etape, sous, repondre };
  window.dispatchEvent(new CustomEvent(EVENEMENT_PARCOURS_STUDIO, { detail: demande }));
  if (!demande.prise) repondre('Le Studio s’ouvre depuis la page MimmozIA.');
}

export function CarteCommandeStudio({ carte, messageId }: { carte: CarteCommande; messageId: string }) {
  const conversationId = useCopilotStore((s) => s.currentConversationId);
  const runs = useCopilotStore((s) => s.actionRuns);
  const direct = useCommandesStudio((s) => s.parAppel[carte.appelId]);
  const trace = useMemo(() => suiviDeTrace(runs as never, carte.appelId), [runs, carte.appelId]);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    // Envoi quand la réponse est persistée (vrai id du message) : le compte rendu s'y rattache.
    if (!conversationId || messageId.startsWith('local-')) return;
    let local: Storage | null = null;
    try { local = localStorage; } catch { local = null; }
    if (!doitEnvoyer(carte, Date.now(), trace !== null, dejaEnvoyee(local, carte.appelId))) return;
    void envoyerCommandeStudio({
      projetId: projetIdChat(conversationId), conversationId, messageId,
      appelId: carte.appelId, libelle: carte.libelle, ...(carte.commande ? { commande: carte.commande } : {}), ...(carte.phrase ? { phrase: carte.phrase } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carte.appelId, conversationId, messageId]);
  const suivi = direct && (direct.etat !== 'attente' || !trace) ? direct : trace ?? direct;
  if (!suivi) return null;
  return (
    <section className="mz-cmd" aria-label="Commande envoyée au Studio">
      <ResultatCommandeStudio suivi={suivi} onOuvrirStudio={() => ouvrirLeStudio('batiment', 'batiment', setNote)} />
      {note && <p className="mz-cmd__note">{note}</p>}
    </section>
  );
}

/** Comptes rendus automatiques du Studio rattachés à un message (notifications), en lignes discrètes. */
export function LignesStudio({ messageId }: { messageId: string }) {
  const runs = useCopilotStore((s) => s.actionRuns);
  const lignes = useMemo(() => runs.filter((r) => r.messageId === messageId && estTraceStudio(r) && r.params.type === 'notification'), [runs, messageId]);
  if (lignes.length === 0) return null;
  return (
    <ul className="mz-cmd__notifs" aria-label="Activité du Studio">
      {lignes.map((r, i) => <li key={`${String(r.params.notificationId ?? i)}`}><span className="mz-cmd__tag">Studio</span> {r.message}</li>)}
    </ul>
  );
}
