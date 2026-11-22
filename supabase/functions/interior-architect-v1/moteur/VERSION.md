# Moteur embarqué — @mimmoza/interior-core 0.7.1 (instantané figé)

- Source : archive `C:\Users\maigr\Dev\mimmoza-interior-core\interior-core-v0.7.1.zip` (sha256
  `24b87bff32bb6be57d83b2f3146665cf6753d4608942a2bf86f1755a788fa653`), dossier `src/**` (aucun test copié).
  0.7.1 = 0.7.0 + règle F6b du solveur (`solver/index.ts` seul) : un lit ne s'adosse jamais à une baie ni à une
  porte-fenêtre (rejet `tete_baie` ; autre mur / autre orientation, sinon lit non posé avec la raison). Voir
  `CHANGELOG.md` du paquet.
- Copie faite le 22/11/2026 par le lot SUITE-6 (Studio : `docs/vis/SUITE-6-journal.md`) ; seul `moteur/solver/index.ts`
  change depuis 0.7.0 (SUITE-2). Aucun fichier nouveau ni orphelin ; import map inchangée.
- Copie IDENTIQUE vérifiée (`diff -r` contre `src/` du paquet et contre la copie du Studio : aucune différence hors ce fichier).
- Utilisation : `../pipeline.ts` appelle `amenager` sans `tailles`, `disponibles` ni `nuInterieur`. Banc studio, T2–T5
  (`tests/banc-non-regression.test.ts`) : studio, T2, T5 identiques à 0.7.0 ; T3 (ordre / score d'une variante) et T4
  (un chevet et une commode en moins, lits tournés vers un mur plein) mis à jour, tous les lits posés.

## Adaptation des imports (aucune modification de la copie)

Import map `../deno.json` : `zod` → `npm:zod@3` ; une entrée par fichier `.ts` (chemin sans extension) et une
entrée « dossier » pour chaque `index.ts` (SUITE-2 : `./moteur/analyzer/nuInterieur` ajoutée).

## Empreintes sha256 (chemins relatifs à `moteur/`)

```
a8684690fd70e9658ff711ac7ea68640a9d7946afaa75d0b15692131d6bf3556  analyzer/index.ts
93e5121c28733ce80422bce5512e1635fc00854fc1f26afafdf6675a6084d531  analyzer/nuInterieur.ts
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
4067e44e6841eb2c65309d5a9a115c493e5ce15e5f40666e64791bb7fe481a77  programmer/index.ts
4b17aebfc92cca5c36dc0158a6d852136cae451802248c30bb7a17ccdc8bcf86  solver/index.ts
66fa3d16af6dc3cd6c34f27586d791c4b4105858522af9b20b7bd3574fb9100c  style/bibliotheque-studio.ts
035a253c17784d406461ea5442f6761658c0bd3e0be7e61c0d4586476ebe3306  style/index.ts
497ad973104f903a521ec9236244f131e7e51eec7413e13858edfec1a02dd8c3  style/styles.ts
0e9672a2a16634ac513476682498772935619c706507352107676a67b76fe363  style/types.ts
ed8f6c9844cf6e67f25571aa650c8c55ec43206a64fec3b04f08a66ca1928ecb  types.ts
```
