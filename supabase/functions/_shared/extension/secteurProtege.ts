// supabase/functions/_shared/extension/secteurProtege.ts
// =============================================================================
// LOT X3b (14/11/2026) — SECTEUR PROTÉGÉ (Architecte des Bâtiments de France) dans le parcours « extension de maison ».
// Module PUR et DÉTERMINISTE : il lit les réponses (déjà obtenues par le serveur) des deux services de Mimmoza
//   · servitudes d'utilité publique publiées au Géoportail de l'urbanisme (API Carto IGN) : AC1 (abords de monument
//     historique), AC2 (site classé ou inscrit), AC4 (site patrimonial remarquable) ;
//   · base Mérimée (Ministère de la Culture) : monument historique à moins de 500 m — donnée INDICATIVE, utile quand
//     le périmètre délimité des abords n'est pas publié ;
// et en déduit, À TITRE INDICATIF et avec ses sources : secteur protégé oui / non trouvé / non vérifié, avis de l'ABF
// probable, effet sur le régime (seuil de 20 m²), délai d'instruction majoré.
// RÈGLE : aucune donnée inventée. Un service muet, en panne ou partiel → « non vérifié » ; on ne conclut JAMAIS
// « hors secteur protégé » (au mieux « non trouvé dans des bases non exhaustives »).
//
// SOURCES (lues le 14/11/2026) :
//   · service-public.gouv.fr F36777 (vérifiée le 11/12/2024) : « sites protégés » = sites patrimoniaux remarquables,
//     abords des monuments historiques, sites classés ou en instance de classement, réserves naturelles, cœur des parcs
//     nationaux ; hors zone U OU en site protégé, DP de plus de 5 m² jusqu'à 20 m², PC au-delà (référence citée :
//     code de l'urbanisme, art. R421-11 « Déclaration préalable en secteur protégé »). Un agrandissement de 5 m² ou
//     moins demande une DP partout (pas d'effet propre au secteur protégé pour une extension).
//   · service-public.gouv.fr F17578 « Déclaration préalable (DP) » (vérifiée le 22/10/2026) : instruction 1 mois,
//     2 mois en secteur protégé (site patrimonial remarquable, abords de monument historique, site classé ou inscrit,
//     réserve naturelle, cœur de parc national).
//   · service-public.gouv.fr F1986 « Permis de construire (PC) » (vérifiée le 13/02/2026) : maison individuelle 2 mois,
//     3 mois en secteur protégé.
//   · culture.gouv.fr — fiche « délais d'instruction » de l'UDAP de l'Isère (01/2025) : délai majoré (art. R423-24 du
//     code de l'urbanisme) : DP 2 mois, PC maison individuelle 3 mois.
//   · culture.gouv.fr « Réaliser des travaux en abords d'un monument historique » : dans un périmètre délimité des
//     abords, accord de l'ABF pour tous les travaux ; sans périmètre délimité, seulement pour les immeubles dans le
//     champ de visibilité du monument, à moins de 500 m.
//   · culture.gouv.fr FAQ « Mes travaux en site protégé » : accord (avis conforme) en site patrimonial remarquable et
//     en abords ; avis simple en site inscrit (démolitions soumises à accord) ; à moins de 500 m d'un monument sans
//     périmètre délimité, consultation de l'UDAP, la covisibilité n'étant appréciée que par l'ABF ; site classé : une
//     autorisation spéciale s'ajoute dans certains cas.
// =============================================================================

export const SOURCES_SECTEUR = {
  F36777: { titre: 'Service-public.gouv.fr — Agrandissement : quelle autorisation ? (F36777, seuil de 20 m² en site protégé)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F36777' },
  F17578: { titre: 'Service-public.gouv.fr — Déclaration préalable (F17578, délai en secteur protégé)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F17578' },
  F1986: { titre: 'Service-public.gouv.fr — Permis de construire (F1986, délai en secteur protégé)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1986' },
  ABORDS: { titre: 'Ministère de la Culture — Réaliser des travaux en abords d’un monument historique', url: 'https://www.culture.gouv.fr/Sites-thematiques/Monuments-Sites/Interventions-demarches/Realiser-des-travaux-en-abords-d-un-monument-historique' },
  FAQ: { titre: 'Ministère de la Culture — Mes travaux en site protégé : foire aux questions', url: 'https://www.culture.gouv.fr/catalogue-des-demarches-et-subventions/mes-travaux-en-site-protege/foire-aux-questions' },
} as const;

export const NOM_SOURCE_GPU = 'Géoportail de l’urbanisme — servitudes d’utilité publique (API Carto IGN)';
export const NOM_SOURCE_MERIMEE = 'base Mérimée des monuments historiques (Ministère de la Culture)';
export const RAYON_ABORDS_M = 500;

export const MENTION_SECTEUR =
  'Indicatif : à vérifier auprès du service urbanisme de la mairie ou de l’unité départementale de l’architecture et du patrimoine (UDAP). ' +
  'Les bases consultées ne sont pas exhaustives. Ce n’est pas un avis juridique.';

export type EtatSecteur = 'oui' | 'non_trouve' | 'non_verifie';
export type CodeProtection = 'AC1' | 'AC2' | 'AC4' | 'MH';
/** Effet sur le seuil de 20 m² (F36777) : certain, possible (covisibilité, nature inconnue), aucun (site inscrit). */
export type EffetSeuil = 'certain' | 'possible' | 'aucun';

export interface ProtectionTrouvee {
  readonly code: CodeProtection;
  /** Nature lisible (« Site patrimonial remarquable », « Abords de monument historique »…). */
  readonly nature: string;
  readonly nom: string | null;
  /** Phrase complète, avec la source. */
  readonly detail: string;
  readonly effetSeuil: EffetSeuil;
  /** Pour un site AC2 : classé, inscrit ou inconnu. */
  readonly sousType?: 'classe' | 'inscrit' | 'inconnu';
}

export type EtatVerification = 'complete' | 'partielle' | 'echec' | 'non_branchee';
export interface VerificationSource { readonly source: string; readonly etat: EtatVerification; readonly note: string | null }

export interface SecteurProtege {
  readonly v: 1;
  readonly idu: string;
  /** Date de consultation des sources (AAAA-MM-JJ). */
  readonly date: string;
  readonly etat: EtatSecteur;
  /** « oui », « non trouvé », « non vérifié ». */
  readonly libelle: string;
  readonly protections: readonly ProtectionTrouvee[];
  readonly verifications: readonly VerificationSource[];
  /** Pour le régime : vrai = seuil de 20 m² (secteur protégé établi) ; null = possible ou non vérifié ; faux = non trouvé. */
  readonly seuil20: boolean | null;
  /** Avis de l'ABF probable, effet sur le régime, délai d'instruction (phrases complètes). */
  readonly lignes: readonly string[];
  readonly sources: readonly { readonly titre: string; readonly url: string }[];
  readonly mention: string;
}

/** Réponse d'un service : données brutes (contrat { status, summary, stats, items }), échec, ou service non branché (null). */
export type ReponseService = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly raison: string } | null;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max = 160): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const LIBELLES: Record<EtatSecteur, string> = { oui: 'oui', non_trouve: 'non trouvé', non_verifie: 'non vérifié' };
export const libelleEtatSecteur = (e: EtatSecteur): string => LIBELLES[e];
const dateFr = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

/**
 * Catégorie CNIG d'une servitude. Le champ `categorie` est vide dans les réponses réelles (constaté en production :
 * `categorie: null`) : la catégorie se lit alors dans l'identifiant (`idgen` « AC1-172014607-… ») ou la partition
 * (« 172014607_SUP_64_AC1 »).
 */
export function categorieServitude(item: unknown): string | null {
  if (!estObj(item)) return null;
  const c = txt(item.categorie, 10);
  if (c && /^[A-Za-z]{1,4}\d{0,2}$/.test(c)) return c.toUpperCase();
  for (const k of ['idgen', 'idass']) {
    const m = /^([A-Za-z]{1,4}\d{1,2})-/.exec(txt(item[k], 80) ?? '');
    if (m) return m[1]!.toUpperCase();
  }
  const p = /_SUP_[0-9A-Za-z]{2,3}_([A-Za-z]{1,4}\d{1,2})$/.exec(txt(item.partition, 80) ?? '');
  return p ? p[1]!.toUpperCase() : null;
}

/** Lecture de la réponse des servitudes (GPU) : protections AC1 / AC2 / AC4 et complétude de la vérification. */
export function lireServitudesSecteur(r: ReponseService): { verification: VerificationSource; protections: ProtectionTrouvee[] } {
  const ver = (etat: EtatVerification, note: string | null): VerificationSource => ({ source: NOM_SOURCE_GPU, etat, note });
  if (r === null) return { verification: ver('non_branchee', 'service des servitudes non branché'), protections: [] };
  if (!r.ok) return { verification: ver('echec', 'le service des servitudes n’a pas répondu'), protections: [] };
  const d = r.data;
  if (!estObj(d)) return { verification: ver('echec', 'réponse des servitudes illisible'), protections: [] };
  const statut = String(d.status ?? '');
  if (statut === 'no_localization') return { verification: ver('echec', 'parcelle non localisée pour les servitudes'), protections: [] };
  if (statut !== 'ok' && statut !== 'no_data') return { verification: ver('echec', 'le Géoportail de l’urbanisme n’a pas pu être consulté'), protections: [] };
  const stats = estObj(d.stats) ? d.stats : {};
  const lues = typeof stats.couches_interrogees === 'number' ? stats.couches_interrogees : null;
  const total = typeof stats.couches_totales === 'number' ? stats.couches_totales : null;
  const notes: string[] = [];
  let etat: EtatVerification = 'complete';
  if (lues !== null && total !== null && lues < total) { etat = 'partielle'; notes.push(`${total - lues} couche(s) de servitudes sur ${total} non consultée(s)`); }
  if (stats.geometrie_utilisee === 'point') { etat = 'partielle'; notes.push('servitudes cherchées au point central, pas sur tout le contour de la parcelle'); }
  const items = Array.isArray(d.items) ? d.items : [];
  const protections: ProtectionTrouvee[] = [];
  const vus = new Set<string>();
  for (const it of items) {
    const code = categorieServitude(it);
    if (code !== 'AC1' && code !== 'AC2' && code !== 'AC4') continue;
    const o = it as Obj;
    const nom = txt(o.nom, 120);
    const type = txt(o.type_assiette, 80);
    const cle = `${code}|${nom ?? ''}|${type ?? ''}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    const sur = `servitude ${code} publiée au Géoportail de l’urbanisme${type ? ` (${type})` : ''}`;
    if (code === 'AC4') {
      protections.push({ code, nature: 'Site patrimonial remarquable', nom, effetSeuil: 'certain',
        detail: `Site patrimonial remarquable${nom ? ` « ${nom} »` : ''} : ${sur}.` });
    } else if (code === 'AC1') {
      const delimite = !!type && /d[ée]limit|modifi|adapt/i.test(type);
      protections.push({ code, nature: 'Abords de monument historique', nom, effetSeuil: delimite ? 'certain' : 'possible',
        detail: `Abords de monument historique${nom ? ` (« ${nom} »)` : ''} : ${sur}.` });
    } else {
      const t = `${nom ?? ''} ${type ?? ''}`;
      const sousType: 'classe' | 'inscrit' | 'inconnu' = /class/i.test(t) ? 'classe' : /inscri/i.test(t) ? 'inscrit' : 'inconnu';
      const nature = sousType === 'classe' ? 'Site classé' : sousType === 'inscrit' ? 'Site inscrit' : 'Site classé ou inscrit';
      protections.push({ code, nature, nom, sousType, effetSeuil: sousType === 'classe' ? 'certain' : sousType === 'inscrit' ? 'aucun' : 'possible',
        detail: `${nature}${nom ? ` « ${nom} »` : ''} : ${sur}${sousType === 'inconnu' ? ' — classé ou inscrit, la source ne le précise pas' : ''}.` });
    }
  }
  return { verification: ver(etat, notes.length ? notes.join(' ; ') : null), protections };
}

/** Lecture de la réponse Mérimée : monuments à moins de 500 m du centre de la parcelle (indicatif). */
export function lireMerimeeSecteur(r: ReponseService): { verification: VerificationSource; protections: ProtectionTrouvee[] } {
  const ver = (etat: EtatVerification, note: string | null): VerificationSource => ({ source: NOM_SOURCE_MERIMEE, etat, note });
  if (r === null) return { verification: ver('non_branchee', 'service des monuments historiques non branché'), protections: [] };
  if (!r.ok) return { verification: ver('echec', 'la base Mérimée n’a pas répondu'), protections: [] };
  const d = r.data;
  if (!estObj(d)) return { verification: ver('echec', 'réponse de la base Mérimée illisible'), protections: [] };
  const statut = String(d.status ?? '');
  if (statut === 'no_data') return { verification: ver('complete', null), protections: [] };
  if (statut !== 'ok') return { verification: ver('echec', statut === 'no_localization' ? 'parcelle non localisée pour la base Mérimée' : 'la base Mérimée n’a pas pu être consultée'), protections: [] };
  const proches = (Array.isArray(d.items) ? d.items : [])
    .filter((x): x is Obj => estObj(x) && typeof x.distance_m === 'number' && Number.isFinite(x.distance_m) && x.distance_m >= 0 && x.distance_m <= RAYON_ABORDS_M)
    .sort((a, b) => (a.distance_m as number) - (b.distance_m as number));
  if (!proches.length) {
    // Réponse « ok » sans distance exploitable : rien n'est affirmé.
    const total = estObj(d.stats) && typeof d.stats.total === 'number' ? d.stats.total : 0;
    return total > 0
      ? { verification: ver('partielle', 'monuments trouvés sans distance exploitable'), protections: [] }
      : { verification: ver('complete', null), protections: [] };
  }
  const p = proches[0]!;
  const nom = txt(p.nom, 120);
  const prot = txt(p.protection, 60);
  const autres = proches.length - 1;
  return {
    verification: ver('complete', null),
    protections: [{
      code: 'MH', nature: 'Monument historique à moins de 500 m', nom, effetSeuil: 'possible',
      detail: `Monument historique à moins de 500 m : ${nom ? `« ${nom} »` : 'monument sans nom publié'}${prot ? ` (${prot})` : ''} à environ ${Math.round(p.distance_m as number)} m du centre de la parcelle` +
        `${autres > 0 ? `, et ${autres} autre(s)` : ''} — base Mérimée ; donnée INDICATIVE (distance au point repère du monument ; le périmètre délimité des abords, s’il existe, n’est pas connu ici).`,
    }],
  };
}

/** Évalue le secteur protégé d'une parcelle à partir des deux réponses. `date` : AAAA-MM-JJ de la consultation. */
export function evaluerSecteurProtege(idu: string, date: string, gpu: ReponseService, merimee: ReponseService): SecteurProtege {
  const g = lireServitudesSecteur(gpu);
  const m = lireMerimeeSecteur(merimee);
  const protections = [...g.protections, ...m.protections];
  const verifications = [g.verification, m.verification];
  const toutVerifie = verifications.every((v) => v.etat === 'complete');
  const etat: EtatSecteur = protections.length ? 'oui' : toutVerifie ? 'non_trouve' : 'non_verifie';
  const seuil20: boolean | null = protections.some((p) => p.effetSeuil === 'certain') ? true
    : protections.some((p) => p.effetSeuil === 'possible') || !toutVerifie ? null : false;
  const a = (c: CodeProtection) => protections.filter((p) => p.code === c);
  const ac1 = a('AC1'), ac2 = a('AC2'), ac4 = a('AC4'), mh = a('MH');
  const lignes: string[] = [];
  const sources: { titre: string; url: string }[] = [SOURCES_SECTEUR.F36777];
  const ajouterSource = (s: { titre: string; url: string }) => { if (!sources.some((x) => x.url === s.url)) sources.push(s); };
  const manques = verifications.filter((v) => v.etat !== 'complete').map((v) => `${v.source} : ${v.note ?? 'non consultée'}`);

  if (etat === 'oui') {
    lignes.push(...protections.map((p) => p.detail));
    // Avis de l'ABF probable.
    if (ac4.length) { lignes.push('Avis de l’Architecte des Bâtiments de France (ABF) probable : ACCORD requis en site patrimonial remarquable (avis conforme, que la mairie doit suivre) ; le règlement du site peut imposer des prescriptions.'); ajouterSource(SOURCES_SECTEUR.FAQ); }
    if (ac1.length) { lignes.push('Abords de monument historique : dans un périmètre délimité des abords, ACCORD de l’ABF requis pour les travaux ; sans périmètre délimité, accord requis seulement si le projet est visible du monument ou en même temps que lui, à moins de 500 m (covisibilité appréciée par l’ABF).'); ajouterSource(SOURCES_SECTEUR.ABORDS); }
    else if (mh.length) { lignes.push('Avis de l’ABF probable : à moins de 500 m d’un monument historique, le dossier est soumis à l’ABF ; son ACCORD est requis si le projet est en covisibilité avec le monument (ou dans un périmètre délimité des abords) — seul l’ABF peut en juger. Hors covisibilité, pas d’accord requis au titre des abords.'); ajouterSource(SOURCES_SECTEUR.ABORDS); ajouterSource(SOURCES_SECTEUR.FAQ); }
    if (ac2.some((p) => p.sousType === 'classe')) { lignes.push('Site classé : en plus de l’autorisation d’urbanisme, une autorisation spéciale peut être requise selon les travaux.'); ajouterSource(SOURCES_SECTEUR.FAQ); }
    if (ac2.some((p) => p.sousType === 'inscrit')) { lignes.push('Site inscrit : AVIS SIMPLE de l’ABF (la mairie peut ne pas le suivre) ; une démolition reste soumise à son accord.'); ajouterSource(SOURCES_SECTEUR.FAQ); }
    if (ac2.some((p) => p.sousType === 'inconnu')) { lignes.push('Site classé ou inscrit (nature non précisée par la source) : en site inscrit, avis simple de l’ABF ; en site classé, une autorisation spéciale peut s’ajouter.'); ajouterSource(SOURCES_SECTEUR.FAQ); }
    // Effet sur le régime (F36777).
    if (seuil20 === true) lignes.push('Effet sur l’autorisation : en secteur protégé, la déclaration préalable ne vaut que jusqu’à 20 m² créés, même en zone U d’un PLU (au lieu de 40 m²) ; au-delà, permis de construire (F36777).');
    else if (protections.some((p) => p.effetSeuil === 'possible')) lignes.push('Effet possible sur l’autorisation : si la parcelle est bien en secteur protégé, la déclaration préalable ne vaut que jusqu’à 20 m² créés (au lieu de 40 m² en zone U d’un PLU) ; au-delà, permis de construire (F36777).');
    if (protections.length && protections.every((p) => p.sousType === 'inscrit')) lignes.push('La fiche F36777 ne cite pas les sites inscrits parmi les sites protégés où le seuil passe à 20 m².');
    // Délai d'instruction majoré.
    if (protections.every((p) => p.sousType === 'inscrit')) {
      lignes.push('Délai d’instruction d’une déclaration préalable : 2 mois au lieu de 1 en site inscrit (F17578).');
      ajouterSource(SOURCES_SECTEUR.F17578);
    } else {
      lignes.push(`Délai d’instruction ${seuil20 === true ? '' : 'probablement '}majoré d’un mois en secteur protégé : déclaration préalable 2 mois au lieu de 1 (F17578), permis de construire d’une maison individuelle 3 mois au lieu de 2 (F1986) — code de l’urbanisme, art. R423-24.`);
      ajouterSource(SOURCES_SECTEUR.F17578); ajouterSource(SOURCES_SECTEUR.F1986);
    }
    if (manques.length) lignes.push(`Vérification incomplète — ${manques.join(' ; ')}.`);
  } else if (etat === 'non_trouve') {
    lignes.push('Aucun secteur protégé trouvé : pas de servitude d’abords de monument historique, de site classé ou inscrit ni de site patrimonial remarquable publiée au Géoportail de l’urbanisme sur la parcelle, et pas de monument historique à moins de 500 m dans la base Mérimée.');
    lignes.push('Ces bases ne sont pas exhaustives : ce n’est PAS une garantie que la parcelle est hors secteur protégé. En secteur protégé, la déclaration préalable ne vaut que jusqu’à 20 m² créés et l’Architecte des Bâtiments de France est consulté.');
  } else {
    lignes.push(`Secteur protégé NON VÉRIFIÉ — ${manques.join(' ; ')}.`);
    const vues = verifications.filter((v) => v.etat === 'complete').map((v) => v.source);
    if (vues.length) lignes.push(`Rien trouvé dans : ${vues.join(' ; ')} — cela ne suffit pas à conclure.`);
    lignes.push('Rien ne permet de dire que la parcelle est hors secteur protégé. En secteur protégé (abords de monument historique, site patrimonial remarquable, site classé), la déclaration préalable ne vaut que jusqu’à 20 m² créés, l’Architecte des Bâtiments de France est consulté et le délai d’instruction est majoré d’un mois.');
    ajouterSource(SOURCES_SECTEUR.F17578); ajouterSource(SOURCES_SECTEUR.F1986);
  }
  return { v: 1, idu, date, etat, libelle: LIBELLES[etat], protections, verifications, seuil20, lignes, sources, mention: MENTION_SECTEUR };
}

/** Source courte (pour le régime et la pastille) : services consultés et date. */
export function sourceCourteSecteur(s: SecteurProtege): string {
  return `${s.verifications.map((v) => v.source.split(' — ')[0]!.replace(/ \(.*\)$/, '')).join(' et ')}, consultés le ${dateFr(s.date)}`;
}

/** Ligne courte (étape 1 et carte) : « Secteur protégé : oui — Site patrimonial remarquable « … » (… le 14/11/2026). » */
export function ligneCourteSecteur(s: SecteurProtege): string {
  const quoi = s.etat === 'oui'
    ? ` — ${s.protections.map((p) => `${p.nature.toLowerCase()}${p.nom && p.code !== 'MH' ? ` « ${p.nom} »` : ''}`).slice(0, 3).join(', ')}`
    : s.etat === 'non_trouve' ? ' dans les bases consultées (non exhaustives)' : ' (sources indisponibles ou incomplètes : rien n’est conclu)';
  return `Secteur protégé : **${s.libelle}**${quoi} (${sourceCourteSecteur(s)}).`;
}

/** Relecture défensive d'un secteur enregistré (état du parcours relu d'un tour à l'autre) ; null si illisible. */
export function lireSecteurEnregistre(v: unknown): SecteurProtege | null {
  if (!estObj(v) || v.v !== 1 || typeof v.idu !== 'string' || typeof v.date !== 'string') return null;
  if (v.etat !== 'oui' && v.etat !== 'non_trouve' && v.etat !== 'non_verifie') return null;
  if (!Array.isArray(v.protections) || !Array.isArray(v.verifications) || !Array.isArray(v.lignes) || !Array.isArray(v.sources)) return null;
  if (v.seuil20 !== true && v.seuil20 !== false && v.seuil20 !== null) return null;
  return JSON.parse(JSON.stringify(v)) as SecteurProtege;
}
