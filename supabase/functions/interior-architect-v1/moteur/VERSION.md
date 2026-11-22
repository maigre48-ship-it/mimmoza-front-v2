# Moteur embarqué — @mimmoza/interior-core 0.6.0 (instantané figé)

- Source : archive `C:\Users\maigr\Dev\mimmoza-interior-core\interior-core-v0.6.zip` (sha256
  `7e1d795ddd527b1500f84c6e2e07d992e3326e6c8d5a636bc9803c4bd6106ebd`), dossier `src/**` (aucun test copié).
- Copie faite le 22/11/2026 par le lot NUIT-1 (plan VIS-05 § 6) ; remplace la copie 0.3.0 (INT-10b) par écrasement.
  Fichier nouveau : `edition/index.ts`. Modifiés depuis 0.3.0 : critic/index, data/catalog, index,
  pipeline, programmer/index, solver/index, types. Aucun fichier 0.3.0 orphelin.
- Copie IDENTIQUE vérifiée (`diff -r` contre `src/` du zip : aucune différence hors ce fichier).
- Utilisation : `../pipeline.ts` appelle `amenager` sans `tailles` ni `disponibles` : sortie identique à 0.5.0
  (VERSION.md du Studio) ; sur le banc studio, T2–T5, variantes identiques à 0.3.0 (`tests/banc-non-regression.test.ts`).
- ATTENTION : la copie du Studio (`mimmozia-studio/src/core/interieurArchitecte/moteur`) N'EST PLUS identique au zip :
  VIS-12 (`analyzer/nuInterieur.ts`, champ `nuInterieur`) et VIS-13 (`bainTient`, repli douche) l'ont modifiée sur
  place. Ces ajouts ne sont pas dans le paquet : à reporter dans mimmoza-interior-core (0.7.0) puis recopier ici.

## Adaptation des imports (aucune modification de la copie)

Import map `../deno.json` : `zod` → `npm:zod@3` ; une entrée par fichier `.ts` (chemin sans extension) et une
entrée « dossier » pour chaque `index.ts` (NUIT-1 : `./moteur/edition`, `./moteur/edition/index` ajoutées).
Vérification : `deno check index.ts tests/*.ts moteur/index.ts` sans erreur.

## Empreintes sha256 (chemins relatifs à `moteur/`)

```
1a04480aea844f19ec30d8ad979e9a98ced20e7637382c173efe97ff02bb0454  analyzer/index.ts
564598a7165dfae62cd4d7254c199289da63a5b2a77bdd76030ea86aeff54d13  critic/checks.ts
1f07c2edf58b1c36e708de3851911f4caeec1c267c59f6c8fc14f70ffbffed5b  critic/geo.ts
40d19b7872b8ef4a692b56b8f4bbeeffd0d60c48df0e8608394b2394780d50fd  critic/index.ts
04206abea212def39217b49ec82bbd2a84ce1736aa03735b96b3330d975e0787  critic/style-mesures.ts
265bf3fc6aaa9d0e5470b98a56679df7ad2c5f4f5c77b6b3c75dbb6603d400e7  data/CHECKS.md
2f82e30c04f3ed9e0751fc8709614550fb9d586536efc949efeed01fdcf9e4df  data/catalog.ts
2b3ab148c2c781d191e584c6bf7c10e5a4dccec778c95453e3275841d6341b82  data/rules.ts
5b361601bfd31bb3bf49265fcbdf22364e1a908c89d57d18cc78d9ce9ad7ce73  data/schemas.ts
c6921da145fa8091c29d34e8423f58956fedbaadaee34af7383b2208623bd271  edition/index.ts
4f145ffb80d27b9dfab72efdc69a430cfce1b341e8e48442de326fe2e4ea0bbd  geometry/index.ts
abe34fa749d758ce3b37863d469ecc772f42ada626eef05a1f8ef3d2def9ca88  hypotheses/pointsEau.ts
efbb2eaa2204eb91c527e94ec5be9645601c04b8a848f5b3765dec1da5b7b4f9  index.ts
5d06f8ad2cf93dc92dd192f1565c824b970813e32ccd17b4bf5e8d149ab50400  pipeline.ts
6883fdc2d6bc19e88af5601622b5563ec538526f517ff718731f7aba4760ed67  programmer/index.ts
4b17aebfc92cca5c36dc0158a6d852136cae451802248c30bb7a17ccdc8bcf86  solver/index.ts
66fa3d16af6dc3cd6c34f27586d791c4b4105858522af9b20b7bd3574fb9100c  style/bibliotheque-studio.ts
035a253c17784d406461ea5442f6761658c0bd3e0be7e61c0d4586476ebe3306  style/index.ts
497ad973104f903a521ec9236244f131e7e51eec7413e13858edfec1a02dd8c3  style/styles.ts
0e9672a2a16634ac513476682498772935619c706507352107676a67b76fe363  style/types.ts
bfb817ae5bbfc765177e460bd93e560a44aaeeec50fc61fc18f38ed32a4961d5  types.ts
```
