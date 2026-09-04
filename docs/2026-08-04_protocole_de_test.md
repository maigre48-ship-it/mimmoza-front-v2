# Protocole de test — session du 4 août 2026

Tout ce qui a été écrit compile. Rien n'a tourné. Ce document liste ce qu'il
faut cliquer, ce qu'il faut voir, et la requête SQL qui tranche.

L'ordre n'est pas arbitraire : il va du plus révélateur au moins urgent.
Un état de la base relevé avant écriture explique pourquoi.

| | avant test |
|---|---|
| études promoteur | 5 |
| étapes de chaîne enregistrées | **0** |
| conversations copilote | 178 |
| appels d'outils enregistrés | **207** |
| traces d'action | 0 |
| mouvements de jetons | **0** |

Deux chiffres commandent l'ordre. Les 207 appels d'outils existent déjà : le
test 1 montre un résultat sans rien avoir à préparer. Les 0 mouvements de
jetons disent que le chemin de débit n'a jamais tourné — ma réécriture ne peut
donc pas casser un usage existant, et ce test descend en fin de liste.

---

## 1. L'historique du copilote — ✅ passé le 4 août

Les cartes d'outils réapparaissent bien dans les conversations rechargées
(`get_etude_parcelle`, avec son statut et sa durée).

Le test a fait remonter deux défauts distincts dans la barre latérale, corrigés
dans la foulée :

- `fetchConversations` était plafonnée à 50 pour **177 conversations non
  archivées**. Les plus anciennes n'apparaissaient pas, sans message ni bouton
  « voir plus » — un historique tronqué en silence. Limite portée à 500, et
  `select('*')` remplacé par les seules colonnes utiles à la liste.
- aucune date n'était affichée, et `convDate` ignorait `last_message_at`,
  pourtant la clé de tri côté serveur. Les deux tris pouvaient diverger.
  Date relative sous le titre (« hier », « il y a 3 j »), absolue au-delà d'une
  semaine.

---

## 1 bis. Protocole d'origine — pour rejouer le test

C'est le test le plus rentable : 178 conversations et 207 appels d'outils sont
déjà en base, et jusqu'à aujourd'hui `fetchMessages` renvoyait
`toolCalls: []`. Toutes ces cartes étaient perdues au rechargement.

**À faire**

1. Ouvrir le copilote, puis une conversation ancienne dans l'historique —
   idéalement une du 4 août, qui contient `get_parcel_plu` ou
   `get_zonage_plu`.
2. Regarder les messages de l'assistant.

**Attendu** — les cartes d'outils réapparaissent sous les messages, avec le nom
de l'outil et son résultat. Avant aujourd'hui : rien.

**Si c'est vide** — ouvrir la console. Un message
`[copilot] tool calls non relus:` indique un refus RLS, pas une perte de
données ; la lecture est volontairement non bloquante pour que la conversation
s'ouvre quand même.

**Requête de contrôle** — ce que la conversation devrait afficher :

```sql
select m.created_at, m.role, tc.tool_name, tc.status
from copilot_messages m
left join copilot_tool_calls tc on tc.message_id = m.id
where m.conversation_id = '<coller l''id de la conversation>'
order by m.created_at;
```

---

## 2. La chaîne promoteur — 30 minutes

`promoteur_study_steps` est vide : aucune étape n'a jamais été écrite. Tout ce
qui suit crée les premières lignes.

**Parcours**, sur une étude existante ou une nouvelle :

| étape | page | geste qui déclenche l'écriture |
|---|---|---|
| `foncier` | `/promoteur/foncier` | valider la sélection de parcelles |
| `plu` | `/promoteur/foncier` | charger un PLU **avec une zone identifiée** |
| `marche` | `/promoteur/marche` | « Lancer l'analyse » |
| `risques` | `/promoteur/risques` | « Lancer l'analyse » |
| `enveloppe` | `/promoteur/implantation-2d` | dessiner ≥ 1 bâtiment, attendre 1,5 s |
| `programmation` | `/promoteur/programmation` | « Valider le programme » |
| `bilan` | `/promoteur/bilan-promoteur` | rien à cliquer, attendre 1,5 s |
| `synthese` | `/promoteur/synthese` | « Générer la synthèse » |

**Trois points de vigilance**, ce sont les seuls endroits où j'ai mis un
garde-fou plutôt qu'une écriture systématique :

- un PLU **sans** zone identifiée ne doit **pas** passer `plu` en `ready` —
  sinon l'enveloppe se croit débloquée alors qu'elle n'a aucune règle ;
- un programme sans bâtiment ni logement reste `empty`, il ne débloque pas le
  bilan ;
- une synthèse qui conclut `ANALYSE_INSUFFISANTE` reste `empty`.

**Requête de contrôle** — l'état complet de la chaîne :

```sql
select step, status, produced_by, produced_at, summary
from promoteur_study_steps
where study_id = '<id de l''étude>'
order by step;
```

Et ce que la chaîne en déduit, dépendances comprises :

```sql
select * from promoteur_chain_state('<id de l''étude>');
```

**Test de la péremption**, une fois la chaîne complète : retourner sur
`/promoteur/foncier` et recharger un PLU différent. `enveloppe`,
`programmation` et `bilan` doivent basculer en `stale` — c'est le trigger de
propagation, transitivement.

---

## 3. `?autorun=1` et les actions du copilote — 20 minutes

Ce test enchaîne les deux nouveautés : le chat qui lance une étape, et la trace
qui empêche de la relancer.

**À faire**

1. Dans le chat, demander de créer une opération, puis de lancer une étape
   (marché ou risques — les deux ont un bouton, donc un autorun observable).
2. La carte d'action apparaît. Confirmer.
3. La page s'ouvre avec `?study=…&step=…&autorun=1`, et **le calcul doit partir
   seul**, sans clic. C'est précisément ce qui manquait.
4. Revenir au chat, recharger la page du navigateur (F5), rouvrir la même
   conversation.

**Attendu au point 4** — la carte d'action réapparaît **dans son état final**,
sans bouton, avec son résultat. Elle ne doit **pas** afficher « Action
proposée », et surtout **rien ne doit se relancer**.

**Le cas qui compte vraiment** — refaire le point 4 en mode autonome
(`setAutonomy('auto')` dans la console, il n'y a pas encore d'interrupteur dans
l'interface). Sans la trace, une carte restaurée se relancerait toute seule :
opération recréée, étape relancée. C'est le scénario que tout ce mécanisme
existe pour empêcher.

**Requête de contrôle** :

```sql
select action_kind, outcome, decided_by, message, study_id, created_at
from copilot_action_runs
order by created_at desc
limit 10;
```

`decided_by` doit valoir `user` après une confirmation manuelle, `auto` en mode
autonome. Un `outcome = 'refused'` doit apparaître si vous cliquez « Ignorer » —
un refus est une trace comme une autre.

**Le piège que ce test doit attraper** : ouvrir `/promoteur/bilan-promoteur`
avec `?autorun=1`, puis cliquer sur l'onglet « Synthèse ». La synthèse est
rendue *à l'intérieur* du bilan. Elle ne doit **pas** se générer : le hook
compare le paramètre `step` de l'URL à sa propre étape.

---

## 4. L'estimation publique — 5 minutes

`get_dvf_estimate_v3` et `get_dvf_comps_v1` sont passées en `SECURITY DEFINER`,
et `dvf_2025_s1_typed` n'est plus lisible par `anon`.

**À faire** — ouvrir `/analyse-rapide` **en navigation privée**, sans se
connecter, et lancer une estimation. Puis `/particulier/estimation`.

**Attendu** — identique à avant. Si l'estimation revient vide, c'est que les
fonctions lisent autre chose que ce que j'ai identifié ; la console montrera
une erreur de permission sur une relation nommée.

**Contrôle inverse**, dans la console de la page publique — ceci doit
maintenant **échouer** :

```js
await supabase.from('dvf_2025_s1_typed').select('*').limit(1)
```

---

## 5. Le débit de jetons — 5 minutes, probablement sans objet

`token_ledger` est vide : ce chemin n'a jamais tourné. Aucun composant n'appelle
`debitTokensForFeature`. Le test ne peut donc rien révéler d'une régression,
seulement confirmer que la nouvelle règle est correcte le jour où vous
brancherez la consommation.

**Si vous voulez le vérifier maintenant**, connecté, dans la console :

```js
// doit réussir : débit de soi-même
await supabase.rpc('apply_token_ledger_entry', {
  p_user_id: (await supabase.auth.getUser()).data.user.id,
  p_direction: 'debit', p_amount: 1, p_reason: 'feature_usage',
})

// doit échouer : « INTERDIT: un credit ne part pas du client »
await supabase.rpc('apply_token_ledger_entry', {
  p_user_id: (await supabase.auth.getUser()).data.user.id,
  p_direction: 'credit', p_amount: 1000, p_reason: 'admin_adjustment',
})
```

Le premier appel suppose un `billing_profiles` avec un solde ≥ 1 ; il n'en
existe que 2 en base. Sinon l'erreur sera `billing_profile introuvable`, ce qui
est également une réponse correcte.

---

## 6. Ce que le lot 6 a fermé — à parcourir, pas à tester

Les pages ouvertes **sans session** vont maintenant revenir vides là où elles
revenaient peuplées : veille, watchlists, tableaux de bord. C'est le
comportement voulu. Il faut juste ne pas le prendre pour une régression.

Deux vues restent volontairement ouvertes à `anon` parce que des pages sans
session les interrogent : `v_market_active_listings` (`/veille/marche`,
`/promoteur/veille`) et `v_apporteur_deals_pool` (`/apporteur`). Ces deux-là
doivent continuer de fonctionner déconnecté.

---

## Ce qui reste ouvert après ces tests

- `PrivateRoute` ne protège que `/accueil`, `/mimmozia` et `/dashboard`, et lit
  un booléen dans `localStorage`. Tout le reste s'ouvre sans session.
- Dix fonctions `SECURITY DEFINER` font encore confiance à un `p_user_id`
  fourni par l'appelant (alertes, pondérations SmartScore, dossiers banque).
  Listées en fin de `supabase/security/2026-08-04_billing_definer_functions.sql`.
- Le mode autonome n'a pas d'interrupteur dans l'interface.
- `mobility_gtfs` n'est déclaré dans aucun type ; trois sites s'en arrangent,
  dont deux par un cast.
- La protection contre les mots de passe compromis reste désactivée
  (Auth → Providers → Password).
