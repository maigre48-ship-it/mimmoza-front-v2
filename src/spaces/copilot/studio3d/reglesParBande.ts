// src/spaces/copilot/studio3d/reglesParBande.ts
// =============================================================================
// RÈGLES « PAR BANDE » — logique PURE, partagée par le serveur (copilot-chat/agent/conception.ts)
// et par la fiche « Espace 3D » (controlesVolume.ts). Aucune I/O.
//
// Constat (mission du 10/11/2026, Montreuil, PLUi Est Ensemble, indices J et b2) : le règlement fixe
// des valeurs DIFFÉRENTES dans la bande principale (les 18 premiers mètres depuis la voie) et dans la
// bande secondaire (le fond de parcelle) : emprise 80 % / 20 %, hauteur 19,5 m / 13,5 m, R+5 / R+3,
// pleine terre 15 % / 50 %. Faute de modèle, ces règles étaient rangées en « alternative au choix du
// constructeur » et la valeur la plus contraignante (celle du fond) était retenue et marquée confirmée.
//
// Ici : une liste d'options dont les libellés parlent de « bande » est une CONDITION DE PROFONDEUR,
// jamais un choix. La valeur retenue pour le projet est celle de la BANDE PRINCIPALE (là où se
// construit le bâtiment sur rue). Si la bande principale n'est pas identifiable, on ne devine pas :
// l'appelant garde la valeur la plus contraignante.
// =============================================================================

export interface OptionBande { libelle: string; valeur: number }

const RE_BANDE = /\bbandes?\b/iu;
const RE_PRINCIPALE = /\bbande\s+(?:principale|sur\s+(?:rue|voie)|de\s+constructibilit[ée]\s+principale|a\b|1\b|n[°o]\s*1\b)/iu;
const RE_SECONDAIRE = /\bbande\s+(?:secondaire|de\s+fond|arri[èe]re|de\s+constructibilit[ée]\s+secondaire|b\b|2\b|n[°o]\s*2\b)/iu;
/**
 * Profondeur écrite de la bande principale : « bande principale (18 m) », ou « bande principale d'une
 * profondeur de 18 mètres ». Une hauteur citée dans la même phrase (« … limitée à 19,5 m ») n'est PAS une profondeur.
 */
const RE_PROFONDEUR = /\bbande\s+principale\s*(?:\(\s*(\d{1,2}(?:[.,]\d)?)\s*m(?:[èe]tres?)?\s*\)|[^.;\n]{0,40}?\bprofondeur\s+de\s+(\d{1,2}(?:[.,]\d)?)\s*m(?:[èe]tres?)?\b)/iu;
const PROFONDEUR_MIN_M = 5;
const PROFONDEUR_MAX_M = 40;

const fr = (n: number) => String(n).replace('.', ',');

/** Vrai si les options décrivent des bandes (au moins deux options, dont une nommée « bande … »). */
export function estConditionBande(alts: readonly OptionBande[] | null | undefined): boolean {
  return !!alts && alts.length >= 2 && alts.some((a) => RE_BANDE.test(a.libelle));
}

/** L'option de la bande principale (la première si le texte en cite plusieurs cas), sinon null. */
export function optionBandePrincipale(alts: readonly OptionBande[] | null | undefined): OptionBande | null {
  if (!estConditionBande(alts)) return null;
  return alts!.find((a) => RE_PRINCIPALE.test(a.libelle)) ?? null;
}

/** L'option de la bande secondaire (la première), sinon null. */
export function optionBandeSecondaire(alts: readonly OptionBande[] | null | undefined): OptionBande | null {
  if (!estConditionBande(alts)) return null;
  return alts!.find((a) => RE_SECONDAIRE.test(a.libelle)) ?? null;
}

/**
 * Profondeur de la bande principale, en mètres, lue dans les libellés puis dans le texte cité de la règle.
 * null si elle n'est écrite nulle part (on ne la suppose jamais).
 */
export function profondeurBandePrincipaleM(alts: readonly OptionBande[] | null | undefined, ...textes: Array<string | null | undefined>): number | null {
  for (const t of [...(alts ?? []).map((a) => a.libelle), ...textes]) {
    const m = t ? RE_PROFONDEUR.exec(t) : null;
    if (!m) continue;
    const v = Number((m[1] ?? m[2]).replace(',', '.'));
    if (Number.isFinite(v) && v >= PROFONDEUR_MIN_M && v <= PROFONDEUR_MAX_M) return v;
  }
  return null;
}

/**
 * Valeur d'une règle par bande. `plusContraignante` : 'max' pour une règle « minimum » (pleine terre…),
 * 'min' pour une règle « maximum » (hauteur, emprise…), utilisée seulement si la bande principale
 * n'est pas identifiable.
 */
export function valeurParBande(alts: readonly OptionBande[], plusContraignante: 'min' | 'max'): { valeur: number; bandePrincipale: boolean; mesure: string } {
  const p = optionBandePrincipale(alts);
  if (p) {
    const s = optionBandeSecondaire(alts);
    return {
      valeur: p.valeur, bandePrincipale: true,
      mesure: `selon la bande : valeur de la bande principale (sur voie) retenue (${fr(p.valeur)})` +
        (s ? ` ; bande secondaire : ${fr(s.valeur)}` : ''),
    };
  }
  const vals = alts.map((a) => a.valeur);
  const v = plusContraignante === 'max' ? Math.max(...vals) : Math.min(...vals);
  return { valeur: v, bandePrincipale: false, mesure: 'selon la bande : bande principale non identifiée, valeur la plus contraignante retenue' };
}

/** « bande principale de 18 m depuis la voie : 80 % ; bande secondaire : 20 % » (pour les contrôles et les notes). */
export function mentionBandes(alts: readonly OptionBande[], unite: string, ...textes: Array<string | null | undefined>): string {
  const p = optionBandePrincipale(alts);
  const s = optionBandeSecondaire(alts);
  const prof = profondeurBandePrincipaleM(alts, ...textes);
  const u = unite ? ` ${unite}` : '';
  const morceaux: string[] = [];
  if (p) morceaux.push(`bande principale${prof ? ` de ${fr(prof)} m depuis la voie` : ' (profondeur non lue)'} : ${fr(p.valeur)}${u}`);
  if (s) morceaux.push(`bande secondaire : ${fr(s.valeur)}${u}`);
  return morceaux.length ? `règle par bande — ${morceaux.join(' ; ')}` : 'règle par bande';
}
