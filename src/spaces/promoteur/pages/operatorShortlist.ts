export type OperatorCandidate = {
  siren: string;
  nom: string;
  activite: string;
  commune: string | null;
  communeInsee?: string | null;
  adresse: string | null;
  localActivite?: string | null;
  localSiret?: string | null;
  epci?: string | null;
  url: string;
};

export type OperatorLead = { candidate: OperatorCandidate; reason: string; checks: string[] };

/** Classe uniquement des indices vérifiables, sans déduire l'intérêt commercial. */
export function shortlistOperators(candidates: OperatorCandidate[], insee: string, epci: string | null, naf: string, limit = 8): OperatorLead[] {
  const rank = (candidate: OperatorCandidate) =>
    (candidate.communeInsee === insee ? 6 : candidate.epci && candidate.epci === epci ? 3 : 0)
    + (candidate.localActivite === naf ? 2 : 0);
  return [...candidates].sort((a, b) => rank(b) - rank(a) || a.nom.localeCompare(b.nom, 'fr')).slice(0, limit).map((candidate) => {
    const place = candidate.communeInsee === insee ? 'dans la commune étudiée' : candidate.epci && candidate.epci === epci ? 'dans la même intercommunalité' : 'dans le département';
    const activity = candidate.localActivite === naf ? 'activité de l’établissement local conforme au secteur recherché' : `activité principale de l’entreprise ${candidate.activite} ; activité de l’établissement local ${candidate.localActivite || 'non disponible'}`;
    return {
      candidate,
      reason: `Établissement actif repéré ${place} ; ${activity}.`,
      checks: ['Vérifier le type de bâtiments exploités et le format recherché.', 'Confirmer capacité financière, zone d’expansion et intérêt pour cette parcelle.', 'Obtenir les critères techniques, le mode contractuel et une réponse écrite.'],
    };
  });
}
