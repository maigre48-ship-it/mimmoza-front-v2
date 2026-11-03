// src/spaces/copilot/studio3d/programmeBati.ts
//
// PROGRAMME BÂTI LU DANS LA CONVERSATION — logique PURE (testée par node --test).
//
// Le Dossier 3D ne connaissait que « N logements ». Ici, le programme est lu en
// composantes typées, chacune menant à une forme bâtie (implantationProgramme.ts) :
//   - maisons      : « 25 maisons », « village sénior de 10 maisons »,
//                    « 12 maisons jumelées de plain-pied », « vingt-cinq villas » ;
//   - collectif    : « 40 logements sociaux », « immeuble de 30 appartements » ;
//   - résidence    : « résidence de 80 lits », « EHPAD de 90 chambres »,
//                    « résidence services seniors de 60 logements ».
// Programmes mixtes : « 15 maisons et un petit collectif de 20 logements »,
// « 40 logements dont 10 maisons » (→ 10 maisons + 30 logements collectifs).
// Les plafonds (« 40 logements maximum », « au plus 20 maisons ») ne sont pas un programme.

import type { ComposanteProgramme, ProgrammeVolume } from './volumeParcelle.ts';

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'");

const VALEURS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30,
  quarante: 40, cinquante: 50, soixante: 60, cent: 100, cents: 100, mille: 1000,
};
const MOT = '(?:zero|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille)';
/** Nombre en chiffres (« 25 », « 1 200 ») ou en lettres (« vingt-cinq », « quatre-vingt-dix »). */
const NB = `(\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})?|${MOT}(?:(?:[\\s-]+et)?[\\s-]+${MOT})*)`;

/** « vingt-cinq » → 25, « soixante-dix » → 70, « quatre-vingt-dix » → 90, « deux cents » → 200, « 1 200 » → 1200. */
export function nombreFrancais(brut: string): number | null {
  const t = sansAccents(brut).trim();
  if (/^\d/.test(t)) { const n = Number(t.replace(/[\s  ]/g, '')); return Number.isFinite(n) ? n : null; }
  let total = 0, courant = 0;
  for (const mot of t.split(/[\s-]+/).filter(m => m && m !== 'et')) {
    const v = VALEURS[mot];
    if (v === undefined) return null;
    if (v === 100) courant = (courant || 1) * 100;
    else if (v === 1000) { total += (courant || 1) * 1000; courant = 0; }
    else if (v === 20 && courant % 100 === 4) courant += 76; // quatre-vingt(s)
    else courant += v;
  }
  return total + courant;
}

const AVANT = '(?<![\\p{L}\\d])';
const RE_MAISONS = new RegExp(`${AVANT}${NB}\\s+(?:maisons?|villas?|pavillons?|logements?\\s+individuels?)(?![\\p{L}])`, 'giu');
const RE_LITS = new RegExp(`${AVANT}${NB}\\s+(?:lits?|chambres?|places?\\s+d'hebergement)(?![\\p{L}])`, 'giu');
const RE_LOGEMENTS = new RegExp(`${AVANT}${NB}\\s+(?:logements?|appartements?|unites?\\s+de\\s+vie)(?![\\p{L}])`, 'giu');
const PLAFOND_APRES = /^\s*(?:max(?:imum|i)?\b|au\s+plus\b|maximum\b)/;
const PLAFOND_AVANT = /(?:au\s+plus|maximum|max\.?|jusqu'a|pas\s+plus\s+de|plafonne\s+a|limite\s+a)\s*(?:de\s+)?$/;

interface Trouve { n: number; debut: number; fin: number }
function chercher(re: RegExp, t: string): Trouve[] {
  const l: Trouve[] = [];
  for (const m of t.matchAll(re)) {
    const debut = m.index!, fin = debut + m[0].length;
    if (PLAFOND_APRES.test(t.slice(fin, fin + 20)) || PLAFOND_AVANT.test(t.slice(Math.max(0, debut - 30), debut))) continue;
    // « logements individuels » est compté avec les maisons, pas avec le collectif.
    if (re === RE_LOGEMENTS && /^\s+individuels?/.test(t.slice(debut + m[0].length - 0))) continue;
    const n = nombreFrancais(m[1]);
    if (n !== null && n >= 1 && n <= 2000) l.push({ n, debut, fin });
  }
  return l;
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/**
 * Programme bâti écrit dans un texte ; null si aucun nombre de maisons, logements ou lits.
 * Le public (seniors, social, étudiants) est lu dans tout le texte.
 */
export function programmeBatiDepuisTexte(texte: string | null | undefined): { logements: number; libelle: string; composantes: ComposanteProgramme[] } | null {
  if (!texte) return null;
  const t = sansAccents(texte);
  const seniors = /\bsenio|personnes\s+agees|retraite|\behpad\b|autonomie|\bpa\/ph\b/.test(t);
  const social = /\bsocia(?:l|ux|le|les)\b|\blls\b|\bhlm\b|\bplai\b/.test(t);
  const etudiants = /etudiant/.test(t);
  const publicLu: ComposanteProgramme['public'] = seniors ? 'seniors' : etudiants ? 'etudiants' : social ? 'social' : null;
  const composantes: ComposanteProgramme[] = [];

  // Maisons : forme et niveaux lus juste après (« 12 maisons jumelées de plain-pied »).
  const maisons = chercher(RE_MAISONS, t)[0];
  if (maisons) {
    const suite = t.slice(maisons.fin, maisons.fin + 70), autour = t.slice(Math.max(0, maisons.debut - 50), maisons.fin + 70);
    const forme = /\ben\s+bande|accolees|mitoyennes|groupees|en\s+rangee/.test(suite) ? 'bande'
      : /jumel/.test(suite) ? 'jumelee'
      : /individuel|isolee|independant/.test(suite) ? 'individuelle' : null;
    const niveaux = /plain[\s-]?pied|rez[\s-]de[\s-]chaussee\s+seul/.test(autour) ? 1 : /\br\s*\+\s*1\b|a\s+etage|avec\s+etage/.test(autour) ? 2 : null;
    const qualif = [forme === 'bande' ? 'en bande' : forme === 'jumelee' ? 'jumelées' : forme === 'individuelle' ? 'individuelles' : null,
      niveaux === 1 ? 'de plain-pied' : niveaux === 2 ? 'R+1' : null, publicLu === 'seniors' ? 'seniors' : publicLu === 'social' ? 'sociales' : null].filter(Boolean);
    composantes.push({ type: 'maisons', nombre: maisons.n, unite: 'maisons', public: publicLu, forme, niveaux,
      libelle: `${pluriel(maisons.n, 'maison')}${qualif.length ? ' ' + qualif.join(' ') : ''}` });
  }

  // Résidence en lits / chambres (EHPAD, résidence seniors, résidence étudiante).
  const lits = /residence|ehpad|foyer|maison\s+de\s+retraite|hebergement/.test(t) ? chercher(RE_LITS, t)[0] : undefined;
  if (lits) {
    composantes.push({ type: 'residence', nombre: lits.n, unite: 'lits', public: publicLu, forme: null, niveaux: null,
      libelle: `résidence${publicLu === 'seniors' ? ' seniors' : publicLu === 'etudiants' ? ' étudiante' : ''} de ${pluriel(lits.n, 'lit')}` });
  }

  // Logements collectifs (ou résidence services exprimée en logements).
  const logts = chercher(RE_LOGEMENTS, t).filter(l => !maisons || l.debut !== maisons.debut)[0];
  if (logts && !lits) {
    let n = logts.n;
    // « 40 logements dont 10 maisons » : les maisons font partie du total.
    const dont = maisons && maisons.debut > logts.fin && /^\s*,?\s*dont\s*$/.test(t.slice(logts.fin, maisons.debut));
    if (dont) n -= maisons!.n;
    // « 25 maisons, soit 25 logements » : même programme, pas de collectif en plus.
    const memeNombre = maisons && !dont && logts.n === maisons.n;
    if (n >= 1 && !memeNombre) {
      const residence = /residence\s+(?:services?|senior|autonomie|etudiant|intergeneration)|residence\s+(?:pour\s+)?(?:seniors?|etudiants?)/.test(t);
      composantes.push(residence
        ? { type: 'residence', nombre: n, unite: 'logements', public: publicLu, forme: null, niveaux: null,
            libelle: `résidence${publicLu === 'seniors' ? ' services seniors' : publicLu === 'etudiants' ? ' étudiante' : ''} de ${pluriel(n, 'logement')}` }
        : { type: 'collectif', nombre: n, unite: 'logements', public: publicLu === 'seniors' && maisons ? null : publicLu, forme: null, niveaux: null,
            libelle: `${pluriel(n, 'logement')}${maisons ? ' collectifs' : ''}${publicLu === 'social' ? ' sociaux' : publicLu === 'etudiants' ? ' étudiants' : publicLu === 'seniors' && !maisons ? ' seniors' : ''}` });
    }
  }
  if (!composantes.length) return null;
  return { logements: composantes.reduce((s, c) => s + c.nombre, 0), libelle: composantes.map(c => c.libelle).join(' + '), composantes };
}

/** Programme de la fiche, sinon du dernier message utilisateur qui en chiffre un. */
export function programmeBatiDuContexte(messages: readonly { role: string; text: string }[], fiche: { programme?: string | null; objectif?: string | null } | null): ProgrammeVolume | null {
  const depuisFiche = programmeBatiDepuisTexte(fiche?.programme) ?? programmeBatiDepuisTexte(fiche?.objectif);
  if (depuisFiche) return { ...depuisFiche, origine: 'fiche' };
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    const p = programmeBatiDepuisTexte(messages[i].text);
    if (p) return { ...p, origine: 'conversation' };
  }
  return null;
}
