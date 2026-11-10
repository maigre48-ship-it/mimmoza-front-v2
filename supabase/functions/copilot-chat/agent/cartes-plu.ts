// supabase/functions/copilot-chat/agent/cartes-plu.ts
// =============================================================
// Lot C3 « cartes du chat » (essai témoin du 10/11/2026, Montreuil).
//
// Constat : la carte « Règles du PLU » affichait à l'utilisateur une consigne
// écrite pour le modèle — « ne les invente sous aucun prétexte. Dis à
// l'utilisateur que… ». Le champ `note_repli` du repli sur le Géoportail de
// l'urbanisme mêlait le constat (affiché par le site, apiResultModel.ts) et la
// consigne.
//
// Ce module est PUR (aucun accès réseau, aucune dépendance). Il sépare les deux :
//   · note_repli : le constat et la marche à suivre, lisibles tels quels à l'écran ;
//   · consignes  : ce qui ne s'adresse qu'au modèle (champ jamais affiché par le site,
//                  comme le `consignes` des lectures de règlement).
// Le modèle reçoit toujours les deux champs dans le même résultat d'outil.
// =============================================================

/**
 * Textes du repli « zonage seul » de get_parcel_plu.
 * `lectureAutomatiqueTentee` : la lecture du règlement écrit au Géoportail de
 * l'urbanisme est branchée et n'a pas abouti (son motif est dans `lecture_reglement_gpu`).
 */
export function textesRepliZonageSeul(lectureAutomatiqueTentee: boolean): { note_repli: string; consignes: string } {
  return {
    note_repli:
      "Aucun règlement de PLU n'a été importé sur la page Foncier" +
      (lectureAutomatiqueTentee ? " et le règlement écrit n'a pas pu être lu automatiquement au Géoportail de l'urbanisme" : '') +
      " : ces éléments se limitent au zonage opposable (code de zone, type U/AU/A/N). " +
      "Les règles chiffrées — hauteur maximale, emprise au sol, retraits, stationnement, OAP — ne " +
      "sont pas disponibles ici. Pour les obtenir : joindre le PDF du règlement au chat " +
      "(lecture ciblée de la zone, jusqu'à 50 Mo) ou l'importer sur la page Foncier de Mimmoza.",
    consignes:
      "Ce résultat se limite au ZONAGE OPPOSABLE. Les règles CHIFFRÉES — hauteur maximale, emprise au sol, retraits, " +
      "stationnement, OAP — ne sont PAS disponibles ici : ne les invente sous aucun prétexte. Dis à l'utilisateur que pour " +
      "les obtenir il peut joindre le PDF du règlement au chat (lecture ciblée de sa zone, jusqu'à 50 Mo) " +
      "ou l'importer sur la page Foncier de Mimmoza." +
      (lectureAutomatiqueTentee ? " Le motif de l'échec de la lecture automatique est dans lecture_reglement_gpu." : ''),
  };
}
