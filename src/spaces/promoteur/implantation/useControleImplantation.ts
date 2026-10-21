// src/spaces/promoteur/implantation/useControleImplantation.ts
//
// LOT L1b — branchement React du contrôle d'implantation sourcé.
// Lit le ruleset PLU réel (userStorage, clé isolée par utilisateur), les
// bâtiments de l'éditeur 2D, l'arête « façade terrain », et persiste par étude
// le classement des limites et les validations nominatives.

import type { Feature, MultiPolygon, Polygon } from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { userStorage } from "@/lib/storage/userScopedStorage";
import { useEditor2DStore } from "../plan2d/editor2d.store";
import type { Point2D } from "../plan2d/editor2d.types";
import { anneauxDepuisFeatureLocale, contourBatiment } from "./adapters";
import { calculerDistances, construireSegments, type CategorieLimite, type Pt, type SegmentLimite } from "./boundaryDistances";
import { controlerImplantation, type ControleImplantation } from "./implantationCheck";
import { classementFinal, signatureParcelle, type ChoixClassement } from "./limitesClassement";
import {
  creerValidation,
  creerValidationDepuisSource,
  ecrireValidations,
  extraireReglesRetrait,
  lireRulesetPlu,
  lireValidations,
  type CategorieRegle,
  type EtatRuleset,
  type ValidationsRegles,
} from "./rulesetReculs";

const cleClassement = (studyId: string | null): string =>
  `mimmoza.implantation.classement_limites_v1${studyId ? `.${studyId}` : ""}`;

function lireChoix(studyId: string | null): ChoixClassement | null {
  try {
    const raw = userStorage.getItem(cleClassement(studyId));
    if (!raw) return null;
    const p = JSON.parse(raw) as ChoixClassement;
    return p && typeof p.signature === "string" && p.choix && typeof p.choix === "object" ? p : null;
  } catch {
    return null;
  }
}

export interface ParamsControle {
  readonly parcelleLocal: readonly Point2D[];
  /** Feature de la parcelle en mètres locaux (tous les polygones). */
  readonly featureLocale: Feature<Polygon | MultiPolygon> | null;
  readonly studyId: string | null;
  readonly communeInsee: string | null;
}

export interface EtatControle {
  readonly controle: ControleImplantation;
  readonly segments: readonly SegmentLimite[];
  readonly etatRuleset: EtatRuleset;
  readonly validations: ValidationsRegles;
  readonly nbPolygones: number;
  readonly trousIgnores: number;
  readonly frontEdgeIndex: number | null;
  readonly cotesVisibles: boolean;
  setCotesVisibles(v: boolean): void;
  choisirCategorie(segmentId: string, categorie: CategorieLimite): void;
  confirmerClassement(): void;
  reinitialiserClassement(): void;
  valider(categorie: CategorieRegle, reference: string, par: string): string | null;
  /** L2 — validation « avec la source » (référence documentaire extraite) par une personne nommée. */
  validerAvecSource(categorie: CategorieRegle, par: string): string | null;
  retirerValidation(categorie: CategorieRegle): void;
  recharger(): void;
}

export function useControleImplantation({ parcelleLocal, featureLocale, studyId, communeInsee }: ParamsControle): EtatControle {
  const buildings = useEditor2DStore((s) => s.buildings);
  const frontEdgeIndex = useEditor2DStore((s) => s.parcelFrontEdgeIndex);

  const parcelle = useMemo(() => anneauxDepuisFeatureLocale(featureLocale), [featureLocale]);
  const anneaux = useMemo<Pt[][]>(() => {
    if (parcelleLocal.length < 3) return [];
    return [parcelleLocal.map((p) => ({ x: p.x, y: p.y })), ...parcelle.anneaux.slice(1)];
  }, [parcelleLocal, parcelle]);
  const signature = useMemo(() => (anneaux.length > 0 ? signatureParcelle(anneaux) : null), [anneaux]);
  // R2 : validations liées à l'étude, ou à défaut à la parcelle ; jamais à une clé nue partagée.
  const persisterValidations = studyId !== null || signature !== null;

  const [etatRuleset, setEtatRuleset] = useState<EtatRuleset>(() => lireRulesetPlu(userStorage));
  const [validations, setValidations] = useState<ValidationsRegles>(() =>
    persisterValidations ? lireValidations(userStorage, studyId, signature) : {},
  );
  const [choix, setChoix] = useState<ChoixClassement | null>(() => lireChoix(studyId));
  const [cotesVisibles, setCotesVisibles] = useState(true);

  const recharger = useCallback(() => {
    setEtatRuleset(lireRulesetPlu(userStorage));
    if (persisterValidations) setValidations(lireValidations(userStorage, studyId, signature));
    setChoix(lireChoix(studyId));
  }, [studyId, signature, persisterValidations]);

  useEffect(() => {
    recharger();
    const onFocus = (): void => recharger();
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onFocus);
    };
  }, [recharger]);

  const segments = useMemo(
    () => construireSegments(anneaux, classementFinal(anneaux, frontEdgeIndex, choix)),
    [anneaux, frontEdgeIndex, choix],
  );

  const contours = useMemo(
    () => buildings.filter((b) => (b.kind ?? "building") === "building").map(contourBatiment),
    [buildings],
  );

  const controle = useMemo(() => {
    const rapport = calculerDistances(segments, anneaux, contours, { includePairs: false });
    return controlerImplantation(segments, rapport, etatRuleset, validations, { communeParcelle: communeInsee });
  }, [segments, anneaux, contours, etatRuleset, validations, communeInsee]);

  const enregistrerChoix = useCallback(
    (c: Record<string, CategorieLimite>, facade?: number | null) => {
      const sig = signatureParcelle(anneaux);
      const facadePrecedente = choix && choix.signature === sig ? (choix.facade ?? null) : null;
      const next: ChoixClassement = { signature: sig, choix: c, facade: facade !== undefined ? facade : facadePrecedente };
      setChoix(next);
      try {
        userStorage.setItem(cleClassement(studyId), JSON.stringify(next));
      } catch {
        /* silencieux */
      }
    },
    [anneaux, studyId, choix],
  );

  // R2 : un clic sur « Façade terrain » (changement de parcelFrontEdgeIndex APRÈS le
  // montage) est enregistré pour CETTE parcelle. La valeur héritée du store global
  // au montage n'est pas un choix : la façade reste « déduite » tant qu'elle n'est
  // pas cliquée ou confirmée ici.
  const frontPrecedent = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (frontPrecedent.current === undefined) {
      frontPrecedent.current = frontEdgeIndex;
      return;
    }
    if (frontPrecedent.current === frontEdgeIndex) return;
    frontPrecedent.current = frontEdgeIndex;
    if (anneaux.length === 0) return;
    const sig = signatureParcelle(anneaux);
    const base = choix && choix.signature === sig ? { ...choix.choix } : {};
    enregistrerChoix(base, frontEdgeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontEdgeIndex]);

  const choixCourants = useCallback((): Record<string, CategorieLimite> => {
    const sig = signatureParcelle(anneaux);
    return choix && choix.signature === sig ? { ...choix.choix } : {};
  }, [anneaux, choix]);

  const choisirCategorie = useCallback(
    (segmentId: string, categorie: CategorieLimite) => enregistrerChoix({ ...choixCourants(), [segmentId]: categorie }),
    [choixCourants, enregistrerChoix],
  );

  const confirmerClassement = useCallback(() => {
    const c = choixCourants();
    for (const s of segments) if (!s.interne && s.categorie !== "non-classee") c[s.baseId] = s.categorie;
    enregistrerChoix(c, frontEdgeIndex);
  }, [choixCourants, enregistrerChoix, segments]);

  const reinitialiserClassement = useCallback(() => enregistrerChoix({}, null), [enregistrerChoix]);

  const valider = useCallback(
    (categorie: CategorieRegle, reference: string, par: string): string | null => {
      if (etatRuleset.statut !== "ok") return "Aucun règlement PLU chargé : ouvrez la page Foncier / PLU.";
      const regle = extraireReglesRetrait(etatRuleset.ruleset)[categorie];
      const r = creerValidation(regle, reference, par);
      if (!r.validation) return r.erreur;
      const next = { ...validations, [categorie]: r.validation };
      setValidations(next);
      if (persisterValidations) ecrireValidations(userStorage, studyId, next, signature);
      return null;
    },
    [etatRuleset, validations, studyId, signature, persisterValidations],
  );

  const validerAvecSource = useCallback(
    (categorie: CategorieRegle, par: string): string | null => {
      if (etatRuleset.statut !== "ok") return "Aucun règlement PLU chargé : ouvrez la page Foncier / PLU.";
      const regle = extraireReglesRetrait(etatRuleset.ruleset)[categorie];
      const r = creerValidationDepuisSource(regle, par);
      if (!r.validation) return r.erreur;
      const next = { ...validations, [categorie]: r.validation };
      setValidations(next);
      if (persisterValidations) ecrireValidations(userStorage, studyId, next, signature);
      return null;
    },
    [etatRuleset, validations, studyId, signature, persisterValidations],
  );

  const retirerValidation = useCallback(
    (categorie: CategorieRegle) => {
      const next = { ...validations };
      delete next[categorie];
      setValidations(next);
      if (persisterValidations) ecrireValidations(userStorage, studyId, next, signature);
    },
    [validations, studyId, signature, persisterValidations],
  );

  return {
    controle,
    segments,
    etatRuleset,
    validations,
    nbPolygones: parcelle.nbPolygones,
    trousIgnores: parcelle.trousIgnores,
    frontEdgeIndex,
    cotesVisibles,
    setCotesVisibles,
    choisirCategorie,
    confirmerClassement,
    reinitialiserClassement,
    valider,
    validerAvecSource,
    retirerValidation,
    recharger,
  };
}
