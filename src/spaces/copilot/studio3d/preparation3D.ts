import { jarvisMassing, studioCommand, studioComposition, type JarvisDraft } from './jarvisDraft.ts';
export type StatutInformation3D = 'fourni-dans-fiche' | 'hypothese' | 'manquant';
export interface InformationPreparation3D { cle: string; libelle: string; statut: StatutInformation3D; detail: string }
export interface DiagnosticPreparation3D { pret: boolean; informations: InformationPreparation3D[]; questions: string[]; blocages: string[] }
const DIMENSIONS = /\b(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)\s*(?:sur|x|×)\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)?\b/gi;
const NIVEAUX = /\bR\s*\+\s*(\d{1,2})\b/gi;
// « R+4 maximum », « jusqu'à R+4 », « hauteur limitée à R+4 » : une limite (PLU, contrainte), pas la hauteur du projet.
const AVANT_LIMITE = /(?:max(?:imum|imale|i)?\.?|au\s+plus|jusqu['’]?\s*(?:à|a|au)|limit[ée]e?s?\s+(?:à|a)|plafonn[ée]e?s?\s+(?:à|a)|n['’]exc[eè]d(?:e|ant)\s+pas|ne\s+d[ée]passant\s+pas|pas\s+plus\s+de|hauteur\s+max(?:imale)?\s*(?::|de)?)\s*(?:de\s+|du\s+)?$/i;
const APRES_LIMITE = /^\s*(?:\(?\s*)?(?:max(?:imum|imale|i)?\b|au\s+plus\b|autoris[ée]s?\b|admis\b|maxi\b)/i;
const estLimite = (texte: string, debut: number, fin: number) => AVANT_LIMITE.test(texte.slice(Math.max(0, debut - 40), debut)) || APRES_LIMITE.test(texte.slice(fin, fin + 20));
/** Valeurs R+N et « N niveaux » décrivant le projet, hors limites réglementaires. */
function niveauxProjet(texte: string): { rn: number[]; totaux: number[]; texteSansLimites: string } {
  let texteSansLimites = texte;
  const rn: number[] = [], totaux: number[] = [];
  for (const m of texte.matchAll(NIVEAUX)) {
    if (estLimite(texte, m.index!, m.index! + m[0].length)) texteSansLimites = texteSansLimites.slice(0, m.index!) + ' '.repeat(m[0].length) + texteSansLimites.slice(m.index! + m[0].length);
    else rn.push(Number(m[1]));
  }
  for (const m of texte.matchAll(/\b(\d{1,2})\s+niveaux?\b/gi)) if (!estLimite(texte, m.index!, m.index! + m[0].length)) totaux.push(Number(m[1]));
  return { rn, totaux, texteSansLimites };
}
const quantites: Record<string, number> = { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 };
/** Présent dans une fiche du copilote ne signifie pas confirmé par l'utilisateur. Aucun chiffre ajouté. */
export function diagnostiquerPreparation3D(fiche: JarvisDraft): DiagnosticPreparation3D {
  const informations: InformationPreparation3D[] = [], questions: string[] = [], blocages: string[] = [];
  const fourni = (cle: string, libelle: string, detail: string) => informations.push({ cle, libelle, statut: 'fourni-dans-fiche', detail });
  const manque = (cle: string, libelle: string, question: string) => { informations.push({ cle, libelle, statut: 'manquant', detail: question }); questions.push(question); blocages.push(cle); };
  const hypothese = (cle: string, libelle: string, detail: string) => informations.push({ cle, libelle, statut: 'hypothese', detail });
  const source = [fiche.objectif, fiche.dimensions, fiche.programme, fiche.style, fiche.contraintes].filter(Boolean).join('. ');
  const dimensions = [...source.matchAll(DIMENSIONS)].map(m => [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))]);
  const projet = niveauxProjet(source);
  const niveaux = projet.rn;
  const noms = new Set([...source.matchAll(/\b(?:b[âa]timent|immeuble)\s+([A-Z])\b/gi)].map(m => m[1].toUpperCase()));
  const comptes = [...source.matchAll(/\b(\d{1,2}|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+(?:b[âa]timents?|immeubles?)\b/gi)].map(m => quantites[m[1].toLowerCase()] ?? Number(m[1]));
  const annonce = Math.max(1, noms.size, ...comptes);
  const multi = annonce > 1;
  const ailes = [...source.matchAll(/\b(?:partie\s+centrale|corps\s+central|aile\s+gauche|aile\s+droite)\b/gi)].length >= 2;
  const massing = jarvisMassing(fiche);
  if (!fiche.objectif?.trim()) manque('objectif', 'Objectif', 'Quel bâtiment souhaitez-vous représenter ?');
  else fourni('objectif', 'Objectif', fiche.objectif);
  if (comptes.some(c => c < 1) || new Set(comptes).size > 1 || (noms.size >= 2 && comptes.some(c => c !== noms.size))) manque('nombre-contradictoire', 'Nombre de bâtiments', 'Le nombre de bâtiments et les bâtiments nommés ne concordent pas. Combien faut-il représenter ?');
  if (annonce > 8) manque('composition-limite', 'Composition', 'Studio accepte huit bâtiments au plus. Quel sous-ensemble voulez-vous préparer ?');
  else if (multi) {
    const composition = studioComposition(fiche);
    if (!massing?.buildings || massing.buildings.length !== annonce || !composition || composition.length !== annonce || composition.some(b => !b.commande)) {
      manque('composition', 'Chaque bâtiment', 'Pour chacun des bâtiments annoncés, indiquez un nom A à H, largeur × profondeur en mètres et R+N ; aucune dimension ne sera reprise d’un autre bâtiment.');
    } else {
      for (const b of massing.buildings) fourni('batiment-' + b.name, b.name, b.largeurM + ' × ' + b.profondeurM + ' m, R+' + (b.niveaux - 1));
      if (massing.separationM === undefined) hypothese('separation', 'Espacement', '8 m entre les bâtiments : hypothèse de présentation du Studio, à vérifier sur la parcelle.');
      else fourni('separation', 'Espacement', massing.separationM + ' m');
    }
  } else if (ailes) {
    if (!massing?.segments) manque('ailes', 'Corps du bâtiment', 'Précisez largeur, profondeur et R+N pour chaque corps ou aile annoncé.');
    else fourni('ailes', 'Corps du bâtiment', massing.segments.map(s => s.name + ' : ' + s.largeurM + ' × ' + s.profondeurM + ' m, R+' + (s.niveaux - 1)).join(' ; '));
  } else {
    if (!dimensions.length) manque('dimensions', 'Dimensions', 'Quelles sont la largeur et la profondeur du bâtiment, en mètres ?');
    else if (new Set(dimensions.map(d => d.join('x'))).size > 1) manque('dimensions-contradictoires', 'Dimensions contradictoires', 'Plusieurs dimensions différentes figurent dans la fiche. Lesquelles faut-il retenir ?');
    else fourni('dimensions', 'Dimensions', dimensions[0].join(' × ') + ' m');
    if (!niveaux.length) manque('niveaux', 'Niveaux', 'Combien de niveaux faut-il représenter ? Indiquez R+0 pour le seul rez-de-chaussée, R+1 pour un étage, etc.');
    else if (new Set(niveaux).size > 1 || /R\s*\+\s*\d+\s*(?:ou|à|a|-)\s*(?:R\s*\+\s*)?\d+/i.test(projet.texteSansLimites)) manque('niveaux-ambigus', 'Niveaux ambigus', 'Plusieurs hauteurs sont proposées. Quel R+N faut-il retenir ?');
    else {
      const niveauxTotaux = projet.totaux;
      if (niveauxTotaux.some(n => n !== niveaux[0] + 1)) manque('niveaux-contradictoires', 'Nombre de niveaux contradictoire', 'Le R+N et le nombre total de niveaux diffèrent. Quel nombre de niveaux faut-il conserver ?');
      else fourni('niveaux', 'Niveaux', 'R+' + niveaux[0]);
    }
  }
  // Contradictions locales : les premières valeurs reconnues ne doivent pas masquer les suivantes.
  if (multi || ailes) {
    const marqueurs = [...source.matchAll(multi ? /\b(?:b[âa]timent|immeuble)\s+([A-Z])\b/gi : /\b(?:partie\s+centrale|corps\s+central|aile\s+gauche|aile\s+droite)\b/gi)];
    for (let index = 0; index < marqueurs.length; index++) {
      const m = marqueurs[index], section = source.slice(m.index, marqueurs[index + 1]?.index);
      const ds = [...section.matchAll(DIMENSIONS)].map(v => Number(v[1].replace(',', '.')) + 'x' + Number(v[2].replace(',', '.')));
      const local = niveauxProjet(section), ns = local.rn, totaux = local.totaux;
      const contradiction = new Set(ds).size > 1 || new Set(ns).size > 1
        || /R\s*\+\s*\d+\s*(?:ou|à|a|-)\s*(?:R\s*\+\s*)?\d+/i.test(local.texteSansLimites)
        || (ns.length > 0 && totaux.some(n => n !== ns[0] + 1));
      if (contradiction) manque('contradiction-' + index, m[0], 'Précisez une seule largeur × profondeur et un seul R+N cohérent pour ' + m[0] + '.');
    }
  }
  if (!blocages.length) {
    const commande = studioCommand(fiche);
    if (!massing || !commande) manque('geometrie', 'Géométrie exploitable', 'Précisez le type de bâtiment, des dimensions comprises entre 3 et 200 m et un R+N exploitable (30 niveaux au plus).');
    else if (!multi && !ailes && (!commande.match(DIMENSIONS) || !commande.match(NIVEAUX))) manque('commande', 'Informations à reporter', 'Reportez largeur × profondeur dans le champ Dimensions et R+N dans Objectif : la commande Studio doit conserver ces chiffres.');
  }
  if (fiche.style?.trim()) fourni('style', 'Style', fiche.style);
  else hypothese('style', 'Style facultatif', 'Aucun style imposé dans la fiche ; les matériaux et ouvertures de présentation restent à vérifier dans Studio.');
  if (massing?.appearance.articulation) hypothese('articulation', 'Articulation de façade', 'Interprétation du Studio : ' + massing.appearance.articulation.depthM + ' m de profondeur et ' + massing.appearance.articulation.bays + ' travées ; à vérifier.');
  return { pret: blocages.length === 0, informations, questions, blocages };
}
/** Appelé avant validation et, surtout, avant toute entrée/sortie du transfert partagé film/3D. */
export function exigerPreparation3D(fiche: JarvisDraft): DiagnosticPreparation3D {
  const diagnostic = diagnostiquerPreparation3D(fiche);
  if (!diagnostic.pret) throw new Error('Projet 3D à préciser : ' + diagnostic.questions.join(' '));
  return diagnostic;
}

/** Contrôle structurel avant I/O ; ne certifie pas la topologie ni la conformité cadastrale. */
export function exigerParcelle3D(valeur: unknown): void {
  const objet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const point = (p: unknown): p is number[] => Array.isArray(p) && p.length >= 2
    && typeof p[0] === 'number' && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180
    && typeof p[1] === 'number' && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90;
  const anneau = (r: unknown): boolean => {
    if (!Array.isArray(r) || r.length < 4 || !r.every(point)) return false;
    const a = r[0], fin = r[r.length - 1];
    if (a[0] !== fin[0] || a[1] !== fin[1]) return false;
    // Translation avant shoelace pour limiter les annulations numériques sur les petites parcelles.
    let aire = 0;
    for (let i = 0; i < r.length - 1; i++) aire += (r[i][0] - a[0]) * (r[i + 1][1] - a[1]) - (r[i + 1][0] - a[0]) * (r[i][1] - a[1]);
    return Number.isFinite(aire) && Math.abs(aire) > 0;
  };
  const polygone = (c: unknown): boolean => Array.isArray(c) && c.length > 0 && c.every(anneau);
  const g = objet(valeur) && valeur.type === 'Feature' ? valeur.geometry : valeur;
  const valide = objet(g) && (g.type === 'Polygon' ? polygone(g.coordinates)
    : g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length > 0 && g.coordinates.every(polygone));
  if (!valide) throw new Error('Confirmez une parcelle avec un contour cadastral fermé, des coordonnées valides et une surface non nulle avant le transfert 3D.');
}
