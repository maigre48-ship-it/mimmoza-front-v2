// Réponse réelle (raccourcie) d'une étude de parcelle, telle que stockée par copilot-chat.
export const QUESTION_ETUDE = 'Analyse cette adresse (faisabilité, contraintes réglementaires et potentiel) : 32 chemin de behereko errota, ascain';

export const REPONSE_ETUDE = `Je commence par résoudre l'adresse en parcelle cadastrale avant de lancer l'étude complète.La parcelle repérée est de seulement 66 m² — vraisemblablement une parcelle d'accès ou de voirie.

## Périmètre de l’étude
- **Type d’ancrage** : cadastral_parcel
- **Parcelle cadastrale résolue** : oui
- **Identifiant cadastral** : 64065000AI0001
- **Commune** : Ascain
- **Code INSEE** : 64065
- **Coordonnées** : 43.348434, -1.621429

## 1. Identité et ancrage
- **Surface cadastrale (contenance)** : 66 m²
  - statut : confirmed ; portée : parcel ; source : DGFiP / IGN — API Carto, parcellaire cadastral (contenance) ; confiance : 85/100

## 2. Contraintes réglementaires et risques
- **Servitudes d'utilité publique** : detail : count : 1 ; label : Plan_de_prevention_des_risques_naturels_previsibles_et_des_risques_miniers, count : 1 ; label : Pont sur la Nivelle, count : 1 ; label : Eglise de l'Assomption, count : 1 ; label : Maison Earle, count : 1 ; label : Ensemble dit du Labourd ; intersection démontrée : non ; nb recensees : 5
  - statut : estimated ; portée : nearby ; source : Géoportail de l'urbanisme (GPU) — Servitudes d'utilité publique ; confiance : 30/100
  - Avertissement : Aucune intersection démontrée par la source : les servitudes recensées sont situées À PROXIMITÉ. Ne pas écrire qu'elles grèvent la parcelle. Le GPU n'est pas exhaustif — l'absence de servitude au GPU ne vaut pas absence de servitude.
- **Risque d'inondation** : PPRI déclaré par la source : non ; signal communal d’inondation : oui
  - statut : confirmed ; portée : municipality ; source : BRGM / Géorisques — Géorisques (GASPAR, aléas, ICPE, SIS) ; confiance : 60/100
  - Avertissement : Signal d'inondation fourni à l'échelle communale. Il ne prouve pas que l'adresse ou la parcelle est exposée.
- **Retrait-gonflement des argiles** : non disponible
  - statut : unavailable ; portée : municipality ; source : BRGM / Géorisques — Géorisques (GASPAR, aléas, ICPE, SIS) ; confiance : 0/100
  - Avertissement : Donnée non disponible — vérification requise.
- **Sismicité** : 3
  - statut : confirmed ; portée : municipality ; source : BRGM / Géorisques — Géorisques (GASPAR, aléas, ICPE, SIS) ; confiance : 60/100
  - Avertissement : Aléa qualifié à l'échelle communale par la source. Son emprise réelle au droit de la parcelle doit être vérifiée sur le zonage réglementaire opposable.
- **Feux de forêt** : oui
  - statut : confirmed ; portée : municipality ; source : BRGM / Géorisques — Géorisques (GASPAR, aléas, ICPE, SIS) ; confiance : 60/100
  - Avertissement : Aléa qualifié à l'échelle communale par la source. Son emprise réelle au droit de la parcelle doit être vérifiée sur le zonage réglementaire opposable.
- **Classement sonore des voies** : non disponible
  - statut : unavailable ; portée : nearby ; source : Préfecture / Géoportail de l'urbanisme — Classement sonore des infrastructures de transport ; confiance : 0/100
  - Avertissement : Donnée non disponible — vérification requise. Motif : no_data. L'absence de donnée ne vaut pas absence de contrainte.

## 3. Données physiques et réseaux
- **Pente moyenne du terrain** : 5.7 %
  - statut : confirmed ; portée : point ; source : IGN — RGE ALTI (modèle numérique de terrain) ; confiance : 70/100
- **Assainissement** : mode : non collectif
  - statut : confirmed ; portée : municipality ; source : ministère de la Santé / SISPEA — Services d'assainissement communaux ; date source : 2025 ; confiance : 70/100
  - Avertissement : Donnée COMMUNALE. L'existence d'un service d'assainissement dans la commune ne vaut PAS raccordement.

## 4. Données économiques
- **Loyer de référence** : médiane appartement : 13.59 ; médiane maison : 14.16 ; valeur retenue : 13.59 €/m²/mois
  - statut : confirmed ; portée : municipality ; source : ministère du Logement / ANIL — Carte des loyers (indicateurs communaux) ; date source : 2025 ; confiance : 70/100
- **Prix au m² (transactions comparables)** : categories : Maison, Appartement ; extremes ecartes : 1 ; mutations comparables : 8 ; prix m2 median robuste : 4460 €/m²
  - statut : estimated ; portée : nearby ; source : DGFiP — Demandes de valeurs foncières (DVF) ; confiance : 30/100
  - Avertissement : L'échantillon mélange 2 catégories de biens (Maison, Appartement). information non restituée des prix très forte (324 % de la médiane) : le marché local n'est pas homogène.

## Vérification d’urbanisme au point d’adresse
- **Zone GPU** : UC
- **Prescriptions surfaciques GPU** : Indice I de la zone inondable à titre indicatif Cf. Plan Prévention du Risque Inondation PPRI approuvé par AP le 06/02/2014
- **Assiettes de servitudes GPU** : Plan_de_prevention_des_risques_naturels_previsibles_et_des_risques_miniers ; Pont sur la Nivelle
- Portée : point d’adresse uniquement ; une adresse peut couvrir plusieurs parcelles.
- Source : Géoportail de l’urbanisme via API Carto IGN.

## Illustration de taxe foncière selon la surface du bâtiment
Taux global de taxe foncière bâtie publié pour la commune : 31.75 % (exercice 2025).
| Surface supposée | Valeur locative supposée | Base imposable supposée | Taxe bâtie illustrative |
| ---: | ---: | ---: | ---: |
| 80 m² | 8 000 € | 4 000 € | 1 270 €/an |
| 120 m² | 12 000 € | 6 000 € | 1 905 €/an |

## 5. Verdict, limites et première action
- **Potentiel — niveau attribué par le moteur** : intermediaire
- **Risque — niveau attribué par le moteur** : eleve
- **Portée du verdict de risque** : municipality
- **Niveau décisionnel du risque** : etabli
- **Fiabilité — score attribué par le moteur** : 76/100
- **Recommandation attribuée par le moteur** : poursuivre_sous_conditions
- **Motif du moteur** : Poursuite possible sous réserve de lever : niveau de risque élevé, potentiel intermediaire. La constructibilité reste indéterminable : elle ne dépend pas de ces indicateurs mais du règlement PLU opposable, non collecté par cette étude.
- **Constructibilité** : indéterminable — règlement PLU opposable absent des données de cette étude
- **Première action du plan** : Consulter le règlement PLU opposable de la zone (règlement écrit, plan de zonage, OAP, annexes)

**Données ou preuves indisponibles**
- Retrait-gonflement des argiles : Donnée non disponible — vérification requise.
- Classement sonore des voies : Donnée non disponible — vérification requise. Motif : no_data. L'absence de donnée ne vaut pas absence de contrainte.

**Services techniques indisponibles**
- Aucune défaillance technique signalée par le moteur (indépendamment des données absentes ci-dessus).

À faire valider par un professionnel.

## Ce qu'il faut retenir

⚠️ **Point d'attention préalable sur l'assiette foncière** : la parcelle cadastrale identifiée au point de l'adresse (section AI n° 0001) n'affiche que **66 m²** — c'est typique d'une parcelle de voirie ou d'accès, non de la propriété entière.

Sur le plan réglementaire, le point d'adresse est classé en **zone UC au PLU d'Ascain** [source : GPU / API Carto IGN]. Le GPU signale de surcroît une **prescription surfacique de zone inondable** (indice I, PPRI approuvé par arrêté préfectoral du 06/02/2014).

---

## Ce qui pèse sur la décision

**1. Prescription PPRI au point d'adresse — contrainte potentiellement bloquante.** L'altitude relevée est de **6 m** [source : IGN / RGE ALTI].

**2. Assiette foncière non confirmée.** La contenance cadastrale de 66 m² ne peut pas représenter la propriété.

---

## La prochaine action

**Consulter le PPRI de la Nivelle** auprès de la DDT des Pyrénées-Atlantiques (ou en mairie d'Ascain).

À faire valider par un professionnel.`;
