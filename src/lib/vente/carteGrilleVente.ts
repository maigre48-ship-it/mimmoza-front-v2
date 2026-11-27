/**
 * VIS-67 — lecture, côté SITE, de la carte « grille de vente » rendue par l'outil Edge `grille_vente`
 * (supabase/functions/copilot-chat/agent/grille-vente.ts). La carte est une carte `commande-studio` ordinaire (le site la
 * transmet au Studio sans rien changer) qui porte en plus `data.grille_vente` : filtre lu, résumé, comparateur et,
 * quand les lots sont connus côté serveur, une synthèse. Pur (aucune dépendance React).
 */
import { COULEURS_STATUT, LIBELLES_ORIENTATION, LIBELLES_STATUT, STATUTS_LOT, euros, type FiltreVente, type Orientation, type StatutLot, type SyntheseLots } from './filtreVente';

export interface CarteGrilleVente {
  readonly resume: string;
  readonly compris: readonly string[];
  readonly comparer: readonly string[];
  readonly filtre: FiltreVente;
  readonly synthese: SyntheseLots | null;
}

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `data` d'un résultat d'outil → carte grille de vente (null : pas une carte de grille de vente). */
export function lireCarteGrilleVente(data: unknown): CarteGrilleVente | null {
  if (!estObj(data) || data.carte !== 'commande-studio' || !estObj(data.grille_vente)) return null;
  const g = data.grille_vente;
  const s = estObj(g.synthese) ? g.synthese as unknown as SyntheseLots : null;
  const syntheseSure = s && typeof s.total === 'number' && typeof s.retenus === 'number' && Array.isArray(s.lots) ? s : null;
  return {
    resume: typeof g.resume === 'string' ? g.resume : 'tous les lots',
    compris: Array.isArray(g.compris) ? g.compris.filter((x): x is string => typeof x === 'string').slice(0, 12) : [],
    comparer: Array.isArray(g.comparer) ? g.comparer.filter((x): x is string => typeof x === 'string').slice(0, 3) : [],
    filtre: estObj(g.filtre) ? g.filtre as FiltreVente : {},
    synthese: syntheseSure,
  };
}

export interface LigneCarte { readonly lot: string; readonly detail: string; readonly prix: string; readonly statut: StatutLot; readonly fond: string; readonly encre: string }

/** Textes prêts à afficher dans la carte du chat. Pur. */
export function textesCarteGrilleVente(c: CarteGrilleVente): { titre: string; sousTitre: string; lignes: LigneCarte[]; pastilles: { statut: StatutLot; libelle: string; nombre: number; fond: string; encre: string }[] } {
  const s = c.synthese;
  const titre = s ? `${s.retenus} lot${s.retenus > 1 ? 's' : ''} sur ${s.total}` : 'Grille de vente';
  const prix = s && s.prixMin !== null && s.prixMax !== null ? ` · de ${euros(s.prixMin)} à ${euros(s.prixMax)}` : '';
  const sousTitre = `${c.resume}${prix}${c.comparer.length >= 2 ? ` · comparateur : ${c.comparer.join(' / ')}` : ''}`;
  const lignes: LigneCarte[] = (s?.lots ?? []).map((l) => ({
    lot: l.lot,
    detail: `${l.typologie === 'commerce' ? 'Commerce' : l.typologie} · ${l.niveau === 0 ? 'RDC' : `R+${l.niveau}`} · ${String(l.shabM2).replace('.', ',')} m²${l.orientation ? ` · ${LIBELLES_ORIENTATION[l.orientation as Orientation]}` : ''}`,
    prix: l.prixEur === null ? '—' : euros(l.prixEur),
    statut: l.statut, fond: COULEURS_STATUT[l.statut].fond, encre: COULEURS_STATUT[l.statut].encre,
  }));
  const pastilles = s ? STATUTS_LOT.filter((x) => s.parStatut[x] > 0).map((x) => ({ statut: x, libelle: LIBELLES_STATUT[x], nombre: s.parStatut[x], fond: COULEURS_STATUT[x].fond, encre: COULEURS_STATUT[x].encre })) : [];
  return { titre, sousTitre, lignes, pastilles };
}
