// =============================================================================
// Réparation du mojibake des sources publiques françaises
// -----------------------------------------------------------------------------
// Le symptôme : « HÃ´pital de la Reine » au lieu de « Hôpital de la Reine »,
// observé dans les servitudes d'utilité publique renvoyées par l'API Carto de
// l'IGN.
//
// La cause n'est PAS chez nous. `Response.json()` décode en UTF-8, correctement.
// Le texte arrive déjà abîmé : quelque part en amont, des octets UTF-8 ont été
// relus comme du Latin-1 puis ré-encodés en UTF-8. « ô » (0xC3 0xB4) devient
// alors « Ã´ » (0xC3 0x83 0xC2 0xB4). C'est un grand classique des jeux de
// données publics français, où les chaînes transitent par des exports CSV et des
// bases dont l'encodage n'est pas déclaré.
//
// On ne peut pas corriger la source : on répare à la frontière, au moment où la
// donnée entre chez nous — et jamais plus tard, pour ne pas réparer deux fois.
// =============================================================================

/**
 * Signatures caractéristiques d'un texte UTF-8 relu en Latin-1.
 *
 * `Ã` suivi d'une lettre accentuée couvre l'essentiel du français (à â ä é è ê
 * ë î ï ô ö ù û ü ç). `Â` précède les caractères de la plage 0x80-0xBF :
 * espaces insécables, degrés, guillemets typographiques. `â€` ouvre les
 * apostrophes et tirets typographiques.
 */
/**
 * Caractères que produit la plage 0x80-0x9F quand elle est relue en CP1252.
 *
 * C'est le piège de ce bug : le mojibake réel n'est PAS du Latin-1 pur mais du
 * CP1252, où ces vingt-sept octets donnent des caractères hors plage octet —
 * l'apostrophe typographique ’ devient U+2019 (8217), le tiret cadratin —
 * U+2014. Or ces deux-là sont omniprésents dans les libellés d'urbanisme
 * français (« Château d'eau », « Cimetière — voisinage »).
 *
 * Sans cette table, la reconstitution des octets abandonnait dès la première
 * apostrophe et laissait la chaîne abîmée.
 */
const CP1252_VERS_OCTET: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
};

/** Les mêmes caractères, pour la détection : `Ã` suivi de l'un d'eux. */
const SUITE_CP1252 = Object.keys(CP1252_VERS_OCTET)
  .map((c) => String.fromCharCode(Number(c)))
  .join('');

const SIGNES_MOJIBAKE = new RegExp(
  `Ã[\\x80-\\xBF${SUITE_CP1252}]|Â[\\x80-\\xBF]|â€`,
);

/**
 * Le texte porte-t-il les marques d'un double encodage ?
 *
 * Utilisé comme garde : réparer un texte sain le CASSERAIT — « Ça va » contient
 * un « Ç » parfaitement légitime qu'une conversion aveugle transformerait en
 * charabia.
 */
export function ressembleAMojibake(texte: string): boolean {
  return SIGNES_MOJIBAKE.test(texte);
}

/**
 * Répare un texte doublement encodé. Retourne l'entrée inchangée si elle est
 * saine, ou si la réparation produit un résultat pire.
 */
export function reparerEncodage(texte: string): string {
  if (!texte || !ressembleAMojibake(texte)) return texte;

  try {
    // Chaque caractère de la chaîne abîmée correspond à UN octet de l'original.
    // On reconstitue ces octets, puis on les relit en UTF-8 — l'inverse exact de
    // l'erreur commise en amont.
    const octets = new Uint8Array(texte.length);
    for (let i = 0; i < texte.length; i++) {
      const code = texte.charCodeAt(i);
      // Un caractère hors plage octet vient soit de la table CP1252 ci-dessus,
      // soit d'ailleurs — auquel cas ce n'est pas du mojibake et on renonce.
      const octet = CP1252_VERS_OCTET[code] ?? (code <= 0xff ? code : null);
      if (octet === null) return texte;
      octets[i] = octet;
    }

    // `fatal: true` fait échouer les séquences UTF-8 invalides plutôt que de
    // semer des « � » : mieux vaut garder le texte abîmé que le rendre illisible.
    const repare = new TextDecoder('utf-8', { fatal: true }).decode(octets);

    // Garde-fou : si la réparation laisse encore des marques, c'est qu'on s'est
    // trompé de diagnostic. On préfère l'original.
    return ressembleAMojibake(repare) ? texte : repare;
  } catch {
    return texte;
  }
}

/**
 * Applique la réparation à toutes les chaînes d'une structure, en profondeur.
 *
 * Pratique sur une réponse d'API entière : on ne veut pas énumérer à la main
 * les champs susceptibles de porter des accents, et en oublier un.
 */
export function reparerEncodageProfond<T>(valeur: T): T {
  if (typeof valeur === 'string') return reparerEncodage(valeur) as unknown as T;
  if (Array.isArray(valeur)) return valeur.map(reparerEncodageProfond) as unknown as T;
  if (valeur && typeof valeur === 'object') {
    const sortie: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
      sortie[cle] = reparerEncodageProfond(v);
    }
    return sortie as unknown as T;
  }
  return valeur;
}
