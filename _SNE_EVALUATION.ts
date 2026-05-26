// =============================================================================
// Mimmoza – Évaluation source SNE (Système National d'Enregistrement)
// =============================================================================
//
// CONCLUSION : SNE non branché pour l'instant. Voici pourquoi.
//
// ─── Ce qu'est le SNE ────────────────────────────────────────────────────────
//
// Le SNE (Système National d'Enregistrement des demandes de logement social)
// recense les demandes en attente et les attributions annuelles de HLM.
// C'est la source de "tensionTheorique" dans besoin-logements-sociaux.
//
// ─── Sources officielles disponibles ─────────────────────────────────────────
//
// 1. data.logement.gouv.fr / SDES
//    URL : https://www.statistiques.developpement-durable.gouv.fr/
//    Données : agrégées à la maille EPCI ou département, PAS commune.
//    Format : Excel/CSV annuel, pas d'API temps réel.
//    Granularité insuffisante pour un lookup par code_insee.
//
// 2. demande-logement-social.gouv.fr
//    URL : https://www.demande-logement-social.gouv.fr/
//    C'est le portail citoyen de dépôt de dossier. Pas d'API open data.
//    Reverse-engineering : illégal + impossible (auth SSO FranceConnect).
//
// 3. data.gouv.fr – Fichier SNE national
//    Dataset : "Demandes de logement social" – SDES / DHUP
//    URL connue : https://www.data.gouv.fr/datasets/demandes-de-logement-social/
//    Mise à jour : annuelle (dernier millésime : données 2022/2023)
//    Problème : les données communes sont agrégées, pas toujours disponibles
//               à la maille fine, et le fichier ne contient pas de colonne
//               "code_insee" directement utilisable pour un upsert simple.
//
// ─── Ce qui est faisable (futur sprint) ─────────────────────────────────────
//
// Option A : Import depuis le fichier SDES "demandes par commune"
//   - Vérifier si le fichier Excel du SDES contient bien une ligne par commune
//   - URL à confirmer : https://www.statistiques.developpement-durable.gouv.fr/
//     → Logement → SNE → Fichiers de données
//   - Si oui : même pattern que l'import SRU (fetch CSV → parse → upsert)
//   - Colonnes à mapper : code_insee, nb_demandes_attente, nb_attributions
//
// Option B : Estimation indirecte (hors SNE)
//   - Utiliser le ratio demandes/attributions publié dans les bilans SRU
//   - Croiser avec les données RPLS (Répertoire des Logements Locatifs Sociaux)
//   - RPLS est disponible sur data.gouv.fr à la commune
//     URL : https://www.data.gouv.fr/datasets/repertoire-des-logements-locatifs-sociaux/
//
// ─── Décision actuelle ───────────────────────────────────────────────────────
//
// Table logements_sociaux_sne : reste vide.
// L'Edge Function besoin-logements-sociaux gère déjà ce cas :
//   - hasSne = false → scorePartiel = true (SRU uniquement)
//   - dataStatus = "partial"
// C'est acceptable pour V1 : le score SRU seul est déjà riche.
//
// ─── Table SNE (DDL pour le jour où la source est disponible) ────────────────
//
// CREATE TABLE IF NOT EXISTS public.logements_sociaux_sne (
//   code_insee              TEXT PRIMARY KEY,
//   demandes_en_attente     INTEGER,
//   attributions_annuelles  INTEGER,
//   tension_demande         NUMERIC(6,2),  -- ratio demandes/attributions
//   annee_donnees           SMALLINT,
//   source_url              TEXT,
//   imported_at             TIMESTAMPTZ DEFAULT NOW()
// );
//
// ─── Prochaine action si on veut brancher SNE ────────────────────────────────
//
// 1. Télécharger manuellement le fichier Excel SDES "SNE par commune" depuis :
//    https://www.statistiques.developpement-durable.gouv.fr/
//    Rubrique : Logement > Demande de logement social > Données locales
//
// 2. Vérifier la granularité (commune ou EPCI ?)
//
// 3. Si commune : dupliquer import_sru_national.ts en import_sne_national.ts
//    avec le mapping approprié.
//
// 4. Si EPCI uniquement : implémenter une table de passage EPCI→communes
//    et attribuer les valeurs EPCI à chaque commune membre.
//
// =============================================================================