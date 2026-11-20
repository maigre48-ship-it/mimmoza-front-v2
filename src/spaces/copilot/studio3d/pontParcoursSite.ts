// src/spaces/copilot/studio3d/pontParcoursSite.ts
// =============================================================================
// VIS-18a (20/11/2026) — PONT « PARCOURS ↔ STUDIO », CÔTÉ SITE (protocole mimmoza-parcours-studio v1,
// src/spaces/promoteur/shared/echangeStudio/pontParcoursStudio.ts, copie identique au Studio).
//
// `ouvrirEtapeStudio` : une étape du parcours cliquée → le Studio DÉJÀ OUVERT passe sur l'étape correspondante
//   1. Studio intégré (iframe /studio/) : postMessage à SA fenêtre, à SON origine exacte ;
//   2. sinon Studio ouvert dans un autre onglet (même origine) : BroadcastChannel ; seul un onglet relié au MÊME
//      projet (`mzchat-<conversation>`) répond ;
//   3. aucun accusé dans le délai : `absent` — l'appelant garde son repli (ouvrir le Studio intégré, comme VIS-17).
// L'accusé n'est accepté que de la fenêtre et de l'origine visées (cadre) ou du canal (onglet), pour CETTE requête.
//
// Événement pour le parcours (VIS-18b) : `mimmoza:parcours-ouvrir-etape`, detail { cle, type?, repondre(issue) } —
// écouté par MimmozIAPage (qui connaît le cadre du Studio). `issue.etat === 'absent'` : le parcours fait son action
// habituelle (ex. « Brief relié au rendu », feuille « Image »).
// =============================================================================
import {
  CANAL_DIFFUSION_PARCOURS, creerMessagePont, examinerMessagePont, messageAccuse,
  type ChargeAccuse, type TypeParcoursPont,
} from '../../promoteur/shared/echangeStudio/pontParcoursStudio.ts';

export const EVENEMENT_OUVRIR_ETAPE_STUDIO = 'mimmoza:parcours-ouvrir-etape';
export const DELAI_ACCUSE_MS = 1500;

export interface DemandeEtapeStudio {
  /** Clé du parcours (`volume`, `style`, `interieurs`, `vues`, `scenario`, `pieces`, `apercu`, `final`…). */
  cle?: string;
  type?: TypeParcoursPont;
  /** Ou étape / sous-onglet du Studio directement (événement VIS-17 `mimmoza:parcours-studio`). */
  etapeStudio?: string;
  sousOnglet?: string;
}

export interface IssueEtapeStudio {
  /** ok : le Studio a changé d'étape ; refus : il a répondu non (étape inconnue, autre projet, version) ; absent : aucun Studio. */
  etat: 'ok' | 'refus' | 'absent';
  ou: 'cadre' | 'onglet' | null;
  accuse: ChargeAccuse | null;
  /** Phrase pour l'utilisateur (vide si absent : l'appelant dit la sienne). */
  message: string;
}

export interface DetailOuvrirEtape extends DemandeEtapeStudio {
  repondre: (issue: IssueEtapeStudio) => void;
  prise?: boolean;
}

export interface CadreStudio { fenetre: Window; origine: string }

interface Ecoute {
  ajouter(f: (evt: { origin: string; data: unknown; source: unknown }) => void): () => void;
}

const nouvelId = (): string => {
  try { return `req-${crypto.randomUUID()}`; } catch { return `req-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
};

/** PURE — l'accusé reçu est-il celui attendu (origine, source, requête) ? */
export function accuseAttendu(evt: { origin: string; data: unknown; source: unknown }, attendu: { origine: string; source: unknown; requeteId: string }): ChargeAccuse | null {
  if (evt.source !== attendu.source) return null;
  const d = examinerMessagePont({ origin: evt.origin, data: evt.data }, [attendu.origine], null, false);
  if (d.type !== 'message' || d.message.canal !== 'etape.accuse' || evt.origin !== attendu.origine) return null;
  return d.message.charge.requeteId === attendu.requeteId ? d.message.charge : null;
}

function attendre(ecoute: Ecoute, filtre: (evt: { origin: string; data: unknown; source: unknown }) => ChargeAccuse | null, delaiMs: number): Promise<ChargeAccuse | null> {
  return new Promise((resoudre) => {
    let fini = false;
    const retirer = ecoute.ajouter((evt) => {
      const a = filtre(evt);
      if (!a || fini) return;
      fini = true; clearTimeout(t); retirer(); resoudre(a);
    });
    const t = setTimeout(() => { if (fini) return; fini = true; retirer(); resoudre(null); }, delaiMs);
  });
}

const issueDe = (a: ChargeAccuse | null, ou: 'cadre' | 'onglet'): IssueEtapeStudio => (a === null
  ? { etat: 'absent', ou: null, accuse: null, message: '' }
  : { etat: a.statut === 'ok' ? 'ok' : 'refus', ou, accuse: a, message: messageAccuse(a, ou === 'onglet') });

export interface OptionsOuverture {
  cadre: CadreStudio | null;
  projetId: string | null;
  delaiMs?: number;
  /** Tests : écoute des messages de la fenêtre et canal de diffusion. */
  ecouteFenetre?: Ecoute;
  canal?: { postMessage(m: unknown): void; ecoute: Ecoute } | null;
}

function ecouteFenetreParDefaut(): Ecoute {
  return {
    ajouter: (f) => {
      const h = (e: MessageEvent) => f({ origin: e.origin, data: e.data, source: e.source });
      window.addEventListener('message', h);
      return () => window.removeEventListener('message', h);
    },
  };
}

function canalParDefaut(): (OptionsOuverture['canal'] & { fermer(): void }) | null {
  try {
    if (typeof BroadcastChannel !== 'function') return null;
    const bc = new BroadcastChannel(CANAL_DIFFUSION_PARCOURS);
    return {
      postMessage: (m) => bc.postMessage(m),
      ecoute: { ajouter: (f) => { const h = (e: MessageEvent) => f({ origin: window.location.origin, data: e.data, source: 'diffusion' }); bc.addEventListener('message', h); return () => bc.removeEventListener('message', h); } },
      fermer: () => bc.close(),
    };
  } catch { return null; }
}

/** Ouvre l'étape dans le Studio déjà ouvert (cadre, sinon autre onglet). Ne rejette jamais. */
export async function ouvrirEtapeStudio(d: DemandeEtapeStudio, o: OptionsOuverture): Promise<IssueEtapeStudio> {
  const delai = o.delaiMs ?? DELAI_ACCUSE_MS;
  const charge = {
    ...(d.cle ? { cle: d.cle } : {}), ...(d.type ? { type: d.type } : {}),
    ...(d.etapeStudio ? { etapeStudio: d.etapeStudio } : {}), ...(d.sousOnglet ? { sousOnglet: d.sousOnglet } : {}),
    ...(o.projetId ? { projetId: o.projetId } : {}),
  };
  if (o.cadre) {
    const requeteId = nouvelId();
    const cadre = o.cadre;
    const ecoute = o.ecouteFenetre ?? ecouteFenetreParDefaut();
    const attente = attendre(ecoute, (evt) => accuseAttendu(evt, { origine: cadre.origine, source: cadre.fenetre, requeteId }), delai);
    try { cadre.fenetre.postMessage(creerMessagePont('etape.ouvrir', { requeteId, ...charge }), cadre.origine); } catch { /* cadre fermé */ }
    const issue = issueDe(await attente, 'cadre');
    if (issue.etat !== 'absent') return issue;
  }
  if (!o.projetId) return issueDe(null, 'onglet');
  const canalDefaut = o.canal === undefined ? canalParDefaut() : null;
  const canal = o.canal ?? canalDefaut;
  if (!canal) return issueDe(null, 'onglet');
  try {
    const requeteId = nouvelId();
    const attente = attendre(canal.ecoute, (evt) => {
      const d2 = examinerMessagePont({ origin: evt.origin, data: evt.data }, [], evt.origin, false);
      return d2.type === 'message' && d2.message.canal === 'etape.accuse' && d2.message.charge.requeteId === requeteId ? d2.message.charge : null;
    }, delai);
    canal.postMessage(creerMessagePont('etape.ouvrir', { requeteId, ...charge }));
    return issueDe(await attente, 'onglet');
  } finally {
    canalDefaut?.fermer();
  }
}
