# Moteur embarqué — @mimmoza/interior-core 0.3.0 (instantané figé)

- Source : paquet `@mimmoza/interior-core`, version `0.3.0` (package.json, CHANGELOG 0.3.0 = lot INT-09c), dossier
  `src/**` (aucun test copié). Archive de référence : `C:\Users\maigr\Dev\mimmoza-interior-core\interior-core-v0.3.zip`
  (sha256 `30107169f2f9be82b533f2ef303c88077613f1707bc1ce6613924a5d1863d4a1`).
- Instantané pris le 06/11/2026 à 15:59 (heure de Paris) par le lot INT-10b, depuis `/home/claude/interior-core/src`
  (conteneur de travail). Copie IDENTIQUE vérifiée : `sha256sum` de `src/**` = empreintes ci-dessous.
- Remplace la copie 0.2.0 (INT-10) par écrasement. Fichiers nouveaux : `index.ts`, `pipeline.ts` (`amenager`) ; modifiés
  par rapport à 0.2.0 : `hypotheses/pointsEau.ts` (`candidatsPointsEau`), `solver/index.ts` (option `pieces`). Aucun
  fichier de la copie 0.2.0 n'est devenu orphelin (les 18 fichiers 0.2.0 existent tous en 0.3.0).
- Utilisation : `../pipeline.ts` appelle `amenager` (import direct de `./moteur/pipeline.ts`) ; `VERSION_MOTEUR = '0.3.0'`.

## Adaptation des imports (aucune modification de la copie)

Le moteur importe `zod` et des chemins relatifs SANS extension (`'../types'`, `'./pipeline'`), que Deno ne résout pas.
Plutôt que de modifier les fichiers, l'import map `../deno.json` :
- associe `zod` à `npm:zod@3` ;
- associe chaque chemin sans extension, tel qu'il se résout depuis la copie (`./moteur/types`, `./moteur/pipeline`…),
  au fichier réel (`./moteur/types.ts`, `./moteur/pipeline.ts`…). Génération mécanique : une entrée par fichier
  `.ts`, plus une entrée « dossier » pour chaque `index.ts` (INT-10b : `./moteur`, `./moteur/index`, `./moteur/pipeline`
  ajoutées).

Vérification : `deno check index.ts tests/*.ts moteur/index.ts` passe ; `deno bundle --config deno.json index.ts` passe ;
les empreintes ci-dessous sont celles de `src/**` du paquet 0.3.0.

## Empreintes sha256 (fichiers copiés, chemins relatifs à `moteur/`)

```
1a04480aea844f19ec30d8ad979e9a98ced20e7637382c173efe97ff02bb0454  analyzer/index.ts
564598a7165dfae62cd4d7254c199289da63a5b2a77bdd76030ea86aeff54d13  critic/checks.ts
1f07c2edf58b1c36e708de3851911f4caeec1c267c59f6c8fc14f70ffbffed5b  critic/geo.ts
15d64fb921945fe5fbda66d5c2da02c0d062b1236ea28655c11917bf137cb366  critic/index.ts
04206abea212def39217b49ec82bbd2a84ce1736aa03735b96b3330d975e0787  critic/style-mesures.ts
265bf3fc6aaa9d0e5470b98a56679df7ad2c5f4f5c77b6b3c75dbb6603d400e7  data/CHECKS.md
698a3e70573e617f628a6e46c76ef64fcec50ac4d78aa922bbcc4afb5de69407  data/catalog.ts
2b3ab148c2c781d191e584c6bf7c10e5a4dccec778c95453e3275841d6341b82  data/rules.ts
5b361601bfd31bb3bf49265fcbdf22364e1a908c89d57d18cc78d9ce9ad7ce73  data/schemas.ts
4f145ffb80d27b9dfab72efdc69a430cfce1b341e8e48442de326fe2e4ea0bbd  geometry/index.ts
abe34fa749d758ce3b37863d469ecc772f42ada626eef05a1f8ef3d2def9ca88  hypotheses/pointsEau.ts
55b55e4e77a8206f18dbd4dda400fa07b819df73a6d8e77a40414d7b46e20548  index.ts
261420cdb947bbb549fe9efb1908ed96ac8f05fab85748620707a4e934e250d5  pipeline.ts
6745bf94748965f71232e4b1406c0077fff99fce9a409820c878ae5fa06f39f5  programmer/index.ts
9dcbbf90fe6ef6899efa0b7f85e1267a5ca18ae5342c29dc0df3a93a98add65a  solver/index.ts
66fa3d16af6dc3cd6c34f27586d791c4b4105858522af9b20b7bd3574fb9100c  style/bibliotheque-studio.ts
035a253c17784d406461ea5442f6761658c0bd3e0be7e61c0d4586476ebe3306  style/index.ts
497ad973104f903a521ec9236244f131e7e51eec7413e13858edfec1a02dd8c3  style/styles.ts
0e9672a2a16634ac513476682498772935619c706507352107676a67b76fe363  style/types.ts
0fb1b98fa93c3f685d38e12f76178b30796358f7531c77cf661e85170bde690f  types.ts
```
