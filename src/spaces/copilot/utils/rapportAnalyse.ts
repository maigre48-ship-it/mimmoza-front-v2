// src/spaces/copilot/utils/rapportAnalyse.ts
// ─────────────────────────────────────────────────────────────────────────────
// Mise en forme « rapport professionnel » d'une étude de parcelle.
//
// La réponse de Mimmo à une analyse d'adresse contient, dans cet ordre :
//   1. un préambule de travail (« Je commence par résoudre l'adresse… ») ;
//   2. le rapport factuel produit par le moteur (parcel-study.ts côté serveur),
//      en Markdown technique : codes anglais (confirmed, nearby…), objets
//      aplatis (« detail : count : 1 ; label : … »), avertissements internes ;
//   3. la synthèse rédigée, à partir de « ## Ce qu'il faut retenir ».
//
// Ce module transforme cette matière en document présentable : synthèse en
// tête, chiffres clés, puis annexe de données en tableaux (libellés français,
// fiabilité lisible, sources numérotées, notes dédoublonnées). Le préambule de
// travail n'est jamais imprimé. Aucune donnée n'est inventée : on ne fait que
// traduire et réorganiser ce que le moteur a fourni.
// ─────────────────────────────────────────────────────────────────────────────

export interface DecoupageReponse {
  /** Texte de travail précédant le rapport factuel (non imprimé). */
  preambule: string;
  /** Rapport factuel du moteur (de « Périmètre de l'étude » à la synthèse). */
  factuel: string;
  /** Synthèse rédigée (à partir de « Ce qu'il faut retenir »). */
  synthese: string;
}

/** Découpe une réponse d'étude de parcelle. `null` si ce n'en est pas une. */
export function decouperReponse(text: string): DecoupageReponse | null {
  const t = text.replace(/\r\n/g, '\n');
  const debut = /(^|\n)##\s+Périmètre de l[’']étude/.exec(t);
  if (!debut) return null;
  const startF = debut.index + debut[1].length;
  const fin = /(^|\n)#{1,3}\s+Ce qu['’]il faut retenir\b/i.exec(t.slice(startF));
  const endF = fin ? startF + fin.index + fin[1].length : t.length;
  return {
    preambule: t.slice(0, startF).trim(),
    factuel: t.slice(startF, endF).trim(),
    synthese: t.slice(endF).trim(),
  };
}

// ── Échappement et rendu inline minimal ──────────────────────────────────────
export function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function inline(raw: string): string {
  return esc(raw).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function majuscule(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase('fr-FR') + s.slice(1) : s;
}

// ── Vocabulaire ──────────────────────────────────────────────────────────────
const STATUTS: Record<string, string> = {
  confirmed: 'Confirmé', estimated: 'Estimé', unavailable: 'Non disponible',
  partial: 'Partiel', inferred: 'Déduit', declared: 'Déclaré', derived: 'Calculé',
  observed: 'Observé', modeled: 'Modélisé', modelled: 'Modélisé',
};
const PORTEES: Record<string, string> = {
  parcel: 'Parcelle', nearby: 'Abords', municipality: 'Commune', point: 'Point d’adresse',
  address: 'Adresse', department: 'Département', region: 'Région', iris: 'Quartier (IRIS)',
  national: 'France', epci: 'Intercommunalité', building: 'Bâtiment', unit_fonciere: 'Unité foncière',
};
const CODES: Record<string, string> = {
  cadastral_parcel: 'Parcelle cadastrale', address_point: 'Point d’adresse',
  coordinates: 'Coordonnées GPS', address: 'Adresse',
  intermediaire: 'Intermédiaire', eleve: 'Élevé', tres_eleve: 'Très élevé', faible: 'Faible',
  tres_faible: 'Très faible', moyen: 'Moyen', modere: 'Modéré', fort: 'Fort', nul: 'Nul',
  etabli: 'Établi', provisoire: 'Provisoire', indicatif: 'Indicatif',
  poursuivre: 'Poursuivre', poursuivre_sous_conditions: 'Poursuivre sous conditions',
  approfondir: 'Approfondir', abandonner: 'Abandonner', ecarter: 'Écarter',
  indeterminable: 'Indéterminable', constructible: 'Constructible',
  inconstructible: 'Inconstructible', sous_conditions: 'Sous conditions',
  municipality: 'Commune', parcel: 'Parcelle', nearby: 'Abords',
  no_data: 'aucune donnée',
};
const CLES: Record<string, string> = {
  'prix m2 median robuste': 'prix médian',
  'prix m2 median': 'prix médian',
  'extremes ecartes': 'valeurs extrêmes écartées',
  categories: 'catégories',
  'nb recensees': 'recensées',
  'nb comparables': 'transactions comparables',
  'mutations comparables': 'transactions comparables',
  'periode mois': 'période (mois)',
};
// Mots que les identifiants techniques ont perdus en accents.
const ACCENTS: Record<string, string> = {
  prevention: 'prévention', previsibles: 'prévisibles', recensees: 'recensées',
  ecartes: 'écartés', extremes: 'extrêmes', median: 'médian', mediane: 'médiane',
  categories: 'catégories', Eglise: 'Église', eglise: 'église', securite: 'sécurité',
  periode: 'période', donnees: 'données', reseau: 'réseau', reseaux: 'réseaux',
};
const SIGLES = new Set([
  'PPRI', 'PPRN', 'PPRT', 'PPR', 'PLU', 'PLUI', 'GPU', 'IGN', 'DVF', 'ICPE', 'SIS', 'BRGM',
  'SEVESO', 'UDAP', 'ABF', 'DDT', 'DDTM', 'OAP', 'TEOM', 'PVGIS', 'JRC', 'ANIL', 'SISPEA',
  'GASPAR', 'RGE', 'ALTI', 'IRIS', 'INSEE', 'SPANC', 'CES', 'PDA', 'SUP', 'DPE', 'TFB',
  'VLC', 'CATNAT', 'SCOT', 'SRU', 'ZAC', 'ZNIEFF', 'NGF', 'EPCI', 'API', 'DGFIP', 'PADD',
  'AVAP', 'SPR', 'PSMV', 'ZPPAUP', 'ERP', 'SHON', 'SDP', 'COS', 'CU', 'PC', 'DP', 'PA',
]);

/** « Plan_de_prevention_des_… » → « Plan de prévention des … ». */
function nettoyerIdentifiant(s: string): string {
  let out = s.replace(/([\p{L}\d])_(?=[\p{L}\d])/gu, '$1 ');
  out = out.replace(/(?<![\p{L}])([\p{L}]+)(?![\p{L}])/gu, (m) => ACCENTS[m] ?? m);
  return out;
}

/** Les avertissements du moteur insistent en MAJUSCULES : un rapport non. */
function adoucirMajuscules(s: string): string {
  return s.replace(/(?<![\p{L}])(\p{Lu}{3,})(?![\p{L}])/gu, (m) =>
    SIGLES.has(m.normalize('NFD').replace(/[̀-ͯ]/g, '')) ? m : m.toLocaleLowerCase('fr-FR'));
}

/** Retire ce qui relève des consignes internes du moteur, pas du client. */
function nettoyerAvertissement(s: string): string {
  let out = s
    .replace(/\s*Ne pas écrire[^.]*\./gi, '')
    .replace(/Motif\s*:\s*no_data\.?/gi, '')
    .replace(/information non restituée des prix/gi, 'écart des prix')
    .replace(/\s{2,}/g, ' ')
    .trim();
  out = adoucirMajuscules(nettoyerIdentifiant(out));
  return majuscule(out);
}

function nombresFr(s: string): string {
  return s
    .replace(/(\d{4,})(?=\s?€)/g, (n) => Number(n).toLocaleString('fr-FR'))
    .replace(/(\d)\.(\d)/g, '$1,$2');
}

function traduireCode(v: string): string {
  const k = v.trim();
  if (CODES[k]) return CODES[k];
  if (/^[a-z]+(?:_[a-z]+)+$/.test(k)) return majuscule(k.replace(/_/g, ' '));
  return v;
}

const CLES_PRIORITAIRES = /^(prix médian|valeur retenue)$/;

/** Valeur brute du moteur → texte lisible. */
export function humaniserValeur(brute: string, label = ''): string {
  let s = brute.trim();
  if (!s || /^non disponible$/i.test(s)) return 'Non disponible';
  const sansFormatNombre = /coordonn|identifiant|code insee/i.test(label);

  // Liste d'objets « count : n ; label : X » (servitudes…).
  if (/label : /.test(s)) {
    const labels = [...s.matchAll(/label : (.+?)(?=, count :| ; |$)/g)]
      .map((m) => nettoyerIdentifiant(m[1].trim()));
    const nb = /nb recens[ée]es : (\d+)/.exec(s)?.[1];
    const inter = /intersection démontrée : (oui|non)/.exec(s)?.[1];
    const total = nb ?? String(labels.length);
    let out = `${total} recensée${Number(total) > 1 ? 's' : ''} à proximité : ${labels.join(', ')}`;
    if (inter === 'non') out += ' — aucune intersection démontrée avec la parcelle';
    if (inter === 'oui') out += ' — intersection démontrée avec la parcelle';
    return out;
  }

  // Objet composite « clé : valeur ; clé : valeur ».
  if (/^[^:]+ : .+ ; [^:]+ : /.test(s) || /^[a-zé ]+ : /i.test(s) && s.includes(' ; ')) {
    const paires = s.split(' ; ').map((p) => {
      const i = p.indexOf(' : ');
      if (i < 0) return { cle: '', val: p };
      const cleBrute = p.slice(0, i).trim();
      const cle = CLES[cleBrute] ?? nettoyerIdentifiant(cleBrute);
      return { cle, val: traduireCode(p.slice(i + 3).trim()) };
    });
    paires.sort((a, b) => Number(CLES_PRIORITAIRES.test(b.cle)) - Number(CLES_PRIORITAIRES.test(a.cle)));
    s = paires.map((p) => (p.cle ? `${majuscule(p.cle)} : ${p.val}` : p.val)).join(' · ');
    return sansFormatNombre ? s : nombresFr(s);
  }

  // Valeur simple « mode : non collectif ».
  const simple = /^([a-zé ]+) : (.+)$/i.exec(s);
  if (simple && simple[1].split(' ').length <= 3) s = simple[2];

  s = traduireCode(s);
  s = nettoyerIdentifiant(s);
  if (!sansFormatNombre) s = nombresFr(s);
  return majuscule(s);
}

// ── Lecture du rapport factuel ───────────────────────────────────────────────
interface Preuve {
  label: string;
  valeur: string;
  statut?: string;
  portee?: string;
  source?: string;
  dateSource?: string;
  confiance?: number;
  avertissement?: string;
}
interface Section {
  titre: string;
  preuves: Preuve[];
  /** Lignes non structurées (texte, tableaux, listes simples). */
  reste: string[];
}

function lireSections(factuel: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let derniere: Preuve | null = null;
  for (const ligne of factuel.split('\n')) {
    const h = /^##\s+(.+)$/.exec(ligne.trim());
    if (h) {
      cur = { titre: h[1].trim(), preuves: [], reste: [] };
      sections.push(cur);
      derniere = null;
      continue;
    }
    if (!cur) continue;
    const p = /^- \*\*(.+?)\*\* : (.*)$/.exec(ligne);
    if (p) {
      derniere = { label: p[1].trim(), valeur: p[2].trim() };
      cur.preuves.push(derniere);
      continue;
    }
    const det = /^\s+- statut : (.*)$/.exec(ligne);
    if (det && derniere) {
      for (const morceau of ('statut : ' + det[1]).split(' ; ')) {
        const i = morceau.indexOf(' : ');
        if (i < 0) continue;
        const k = morceau.slice(0, i).trim(), v = morceau.slice(i + 3).trim();
        if (k === 'statut') derniere.statut = v;
        else if (k === 'portée') derniere.portee = v;
        else if (k === 'source') derniere.source = v;
        else if (k === 'date source') derniere.dateSource = v;
        else if (k === 'confiance') derniere.confiance = Number.parseInt(v, 10);
      }
      continue;
    }
    const av = /^\s+- Avertissement : (.*)$/.exec(ligne);
    if (av && derniere) { derniere.avertissement = av[1].trim(); continue; }
    derniere = null;
    cur.reste.push(ligne);
  }
  return sections;
}

// ── Rendu HTML ───────────────────────────────────────────────────────────────
class Registre {
  sources: { libelle: string; date?: string }[] = [];
  numeroSource(libelle: string, date?: string): number {
    const i = this.sources.findIndex((s) => s.libelle === libelle);
    if (i >= 0) {
      if (date && !this.sources[i].date) this.sources[i].date = date;
      return i + 1;
    }
    this.sources.push({ libelle, date });
    return this.sources.length;
  }
}

function badgeFiabilite(p: Preuve): string {
  if (p.statut === 'unavailable' || /^non disponible$/i.test(p.valeur)) {
    return '<span class="badge badge-na">Non disponible</span>';
  }
  const c = p.confiance;
  const cls = c == null ? 'badge-mid' : c >= 70 ? 'badge-ok' : c >= 45 ? 'badge-mid' : 'badge-low';
  const niveau = c == null ? '' : c >= 70 ? 'Bonne' : c >= 45 ? 'Moyenne' : 'Faible';
  const statut = p.statut ? (STATUTS[p.statut] ?? majuscule(p.statut)) : '';
  return `<span class="badge ${cls}">${esc(niveau || statut)}${c != null ? ` · ${c}/100` : ''}</span>`
    + (statut && niveau ? `<div class="sub">${esc(statut)}</div>` : '');
}

function tableauPreuves(preuves: Preuve[], reg: Registre): string {
  const notes: string[] = [];
  const noteDe = (texte: string) => {
    const propre = nettoyerAvertissement(texte);
    if (!propre) return 0;
    const i = notes.indexOf(propre);
    if (i >= 0) return i + 1;
    notes.push(propre);
    return notes.length;
  };
  const lignes = preuves.map((p) => {
    const na = p.statut === 'unavailable' || /^non disponible$/i.test(p.valeur);
    const n = p.avertissement ? noteDe(p.avertissement) : 0;
    const src = p.source ? reg.numeroSource(nettoyerIdentifiant(p.source), p.dateSource) : 0;
    const portee = p.portee ? (PORTEES[p.portee] ?? majuscule(p.portee)) : '—';
    return `<tr${na ? ' class="na"' : ''}>
      <td class="lbl">${inline(nettoyerIdentifiant(p.label))}</td>
      <td class="val">${na ? '—' : esc(humaniserValeur(p.valeur, p.label))}${n ? `<sup class="note">${n}</sup>` : ''}</td>
      <td class="scope">${esc(portee)}</td>
      <td class="fiab">${badgeFiabilite(p)}</td>
      <td class="src">${src ? `[${src}]` : ''}</td>
    </tr>`;
  }).join('');
  const notesHtml = notes.length
    ? `<ol class="notes">${notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : '';
  return `<table class="data">
    <colgroup><col style="width:27%"><col style="width:35%"><col style="width:12%"><col style="width:18%"><col style="width:8%"></colgroup>
    <thead><tr><th>Donnée</th><th>Valeur</th><th>Échelle</th><th>Fiabilité</th><th>Source</th></tr></thead>
    <tbody>${lignes}</tbody></table>${notesHtml}`;
}

function grilleCles(paires: { k: string; v: string }[]): string {
  return `<dl class="kv">${paires.map(({ k, v }) =>
    `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

/** Lignes Markdown libres (listes, tableaux, paragraphes) → HTML sobre. */
function resteEnHtml(lignes: string[], md: (s: string) => string): string {
  const texte = lignes
    .map((l) => nettoyerIdentifiant(l))
    .filter((l) => !/^\s*À faire valider par un professionnel\.?\s*$/i.test(l))
    .join('\n')
    .trim();
  return texte ? md(texte) : '';
}

const LIBELLE_VERDICT = /\s*(?:[—-]\s*)?(?:(?:niveau|score|statut)\s+)?attribu[ée]e?\s+par le moteur/i;

export interface ChiffreCle { k: string; v: string; ton?: 'ok' | 'mid' | 'low' }

function tonRisque(v: string): ChiffreCle['ton'] {
  const s = v.toLowerCase();
  if (/(très )?élevé|fort/.test(s)) return 'low';
  if (/modéré|moyen|intermédiaire/.test(s)) return 'mid';
  if (/faible|nul/.test(s)) return 'ok';
  return undefined;
}

export interface RapportStructure {
  /** HTML de l'annexe de données (tableaux, notes, sources). */
  annexeHtml: string;
  /** Chiffres clés extraits du rapport factuel. */
  chiffresCles: ChiffreCle[];
}

/**
 * Transforme le rapport factuel du moteur en annexe professionnelle.
 * `md` est le convertisseur Markdown → HTML sûr de l'export (injecté pour
 * éviter une dépendance circulaire).
 */
export function structurerRapportFactuel(factuel: string, md: (s: string) => string): RapportStructure {
  const sections = lireSections(factuel);
  const reg = new Registre();
  const cles: ChiffreCle[] = [];
  const valeurDe = (titre: RegExp, label: RegExp) =>
    sections.find((s) => titre.test(s.titre))?.preuves.find((p) => label.test(p.label))?.valeur;

  const commune = valeurDe(/Périmètre/, /^Commune$/);
  const idu = valeurDe(/Périmètre/, /Identifiant cadastral/);
  const surface = valeurDe(/Identité/, /Surface cadastrale/);
  const zone = valeurDe(/urbanisme/i, /^Zone GPU$/);
  if (commune) cles.push({ k: 'Commune', v: commune });
  if (idu) cles.push({ k: 'Parcelle', v: idu });
  if (surface) cles.push({ k: 'Surface cadastrale', v: humaniserValeur(surface) });
  if (zone && !/indisponible|aucun/i.test(zone)) cles.push({ k: 'Zone PLU (GPU)', v: zone });

  const blocs: string[] = [];
  for (const s of sections) {
    const titre = s.titre.replace(/^\d+\.\s*/, '');
    if (/^Périmètre/.test(s.titre)) {
      blocs.push(`<h3>Périmètre de l’étude</h3>${grilleCles(s.preuves.map((p) => ({
        k: p.label, v: humaniserValeur(p.valeur, p.label),
      })))}`);
      continue;
    }
    if (/Verdict/i.test(s.titre)) {
      const paires = s.preuves.map((p) => ({
        k: majuscule(p.label.replace(LIBELLE_VERDICT, '').replace(/^Motif du moteur$/, 'Motif').trim()),
        v: humaniserValeur(p.valeur, p.label),
      }));
      for (const { k, v } of paires) {
        if (/^Risque$/.test(k)) cles.push({ k: 'Niveau de risque', v, ton: tonRisque(v) });
        else if (/^Potentiel$/.test(k)) cles.push({ k: 'Potentiel', v, ton: tonRisque(v) === 'low' ? 'ok' : tonRisque(v) === 'ok' ? 'low' : 'mid' });
        else if (/^Fiabilité$/.test(k)) cles.push({ k: 'Fiabilité des données', v });
        else if (/^Recommandation$/.test(k)) cles.push({ k: 'Recommandation', v });
      }
      const courtes = paires.filter((p) => p.v.length <= 60);
      const longues = paires.filter((p) => p.v.length > 60);
      blocs.push(`<h3>Verdict du moteur et limites</h3>${grilleCles(courtes)}`
        + longues.map((p) => `<p class="para"><strong>${esc(p.k)} :</strong> ${esc(p.v)}</p>`).join('')
        + resteEnHtml(s.reste.map((l) =>
          l.replace(/^(- [^:]+ : )(.*)$/, (_m, a: string, b: string) => a + nettoyerAvertissement(b))), md));
      continue;
    }
    const corps = s.preuves.some((p) => p.statut)
      ? tableauPreuves(s.preuves.filter((p) => p.statut), reg)
        + (s.preuves.some((p) => !p.statut) ? grilleCles(s.preuves.filter((p) => !p.statut).map((p) => ({ k: nettoyerIdentifiant(p.label), v: humaniserValeur(p.valeur, p.label) }))) : '')
      : s.preuves.length
        ? grilleCles(s.preuves.map((p) => ({ k: nettoyerIdentifiant(p.label), v: humaniserValeur(p.valeur, p.label) })))
        : '';
    blocs.push(`<h3>${esc(titre)}</h3>${corps}${resteEnHtml(s.reste, md)}`);
  }

  const sourcesHtml = reg.sources.length
    ? `<h3>Sources</h3><ol class="sources">${reg.sources.map((s) =>
      `<li>${esc(s.libelle)}${s.date ? ` <span class="sub">— millésime ${esc(s.date)}</span>` : ''}</li>`).join('')}</ol>`
    : '';

  return { annexeHtml: blocs.join('') + sourcesHtml, chiffresCles: cles };
}

/** Synthèse rédigée, sans la mention finale répétée par le pied de page. */
export function nettoyerSynthese(synthese: string): string {
  return synthese
    .replace(/(^|\n)\s*À faire valider par un professionnel\.?\s*(?=\n|$)/gi, '$1')
    .replace(/⚠️\s*/g, '')
    .trim();
}

/** « Analyse cette adresse (…) : 32 chemin de x, ascain » → « 32 chemin de X, Ascain ». */
export function titreDepuisQuestion(question?: string | null): string | null {
  const q = question?.trim();
  if (!q || !/adresse|parcelle|terrain|bien/i.test(q)) return null;
  const m = /:\s*([^:]{4,140})$/.exec(q);
  if (!m) return null;
  const minuscules = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'sur', 'à', 'au', 'aux']);
  return m[1].trim().split(/(\s+)/).map((mot, i) =>
    /^\s+$/.test(mot) || (i > 0 && minuscules.has(mot.toLowerCase())) ? mot
      : mot.replace(/^(d['’]|l['’])?(\p{L})/u, (_x, pre = '', l: string) => (pre ?? '') + l.toLocaleUpperCase('fr-FR')),
  ).join('');
}
