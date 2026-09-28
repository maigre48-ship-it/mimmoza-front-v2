import { programmeKind, type ProgrammeKind } from './projectProgramme.ts';
import type { StrategyContext } from '../../../../supabase/functions/design-direction-v1/validation.ts';

export type StyleFamily = 'durable' | 'contemporain' | 'expressif';
export type DesignSource = { id: string; title: string; url: string; year: string; scope: string; observation: string; family: StyleFamily };
export type DesignDirection = { family: StyleFamily; title: string; intent: string; palette: { name: string; hex: string; use: string }[];
  materials: string[]; architecture: string[]; interiors: string[]; lasting: string[]; adaptable: string[];
  vigilance: string; sourceIds: string[] };
export type DesignBrief = { programme: string; target: string; location: string; horizonYears: number; priority: string;
  directions: DesignDirection[]; selectedFamily: StyleFamily | null; adjustments: string; generatedAt: string;
  method?: 'local' | 'ai'; model?: string; recommendedFamily?: StyleFamily; rationale?: string; checks?: string[];
  questionnaire?: { question: string; answer: string }[]; strategy?: StrategyContext };

export const EDITORIAL_SOURCES: DesignSource[] = [
  { id: 'houzz-2026', title: 'Houzz · Prévisions habitat 2026', year: '2026', scope: 'États-Unis · habitat', family: 'durable',
    url: 'https://pro.houzz.com/pro-learn/blog/sneak-peek-houzz-reveals-11-of-the-top-home-design-predictions-for-2026',
    observation: 'La synthèse éditoriale associe savoir-faire classique et projets conçus pour durer, notamment l’adaptation au vieillissement. Signal résidentiel américain, à confronter à la clientèle locale.' },
  { id: 'pinterest-2026', title: 'Pinterest Predicts · Méthode 2026', year: '2026', scope: 'Plateforme visuelle · signaux internationaux', family: 'expressif',
    url: 'https://business.pinterest.com/en-ca/blog/pinterest-predicts-2026-turn-trends-into-unlimited-possibilities/',
    observation: 'Les recherches et contenus visuels permettent de repérer des couleurs et ambiances émergentes. Une popularité sur la plateforme ne prouve ni une demande locale ni une durée de vie esthétique.' },
  { id: 'levels-eu', title: 'Commission européenne · Level(s)', year: 'Cadre européen', scope: 'Europe · cycle de vie du bâtiment', family: 'contemporain',
    url: 'https://green-forum.ec.europa.eu/green-business/levels/quick-introduction-levels_en',
    observation: 'Le cadre Level(s) recommande d’examiner adaptabilité, confort, qualité intérieure et coûts sur toute la vie du bâtiment. C’est un critère de conception, pas un baromètre de goût.' },
];

const KIND: Record<ProgrammeKind, { architecture: string; interiors: string; lasting: string; adaptable: string; vigilance: string }> = {
  hotel: { architecture: 'Entrée lisible, espaces communs liés au lieu et chambres facilement renouvelables.', interiors: 'Chambres calmes, éclairage modulable, rangements et matériaux résistants à l’usage intensif.', lasting: 'Conserver une trame de chambre et une qualité de lumière robustes dans le temps.', adaptable: 'Changer textiles, luminaires et mobilier sans reprendre les réseaux ni les salles d’eau.', vigilance: 'Tester entretien, acoustique, sécurité ERP et coût de renouvellement avec un exploitant.' },
  ehpad: { architecture: 'Parcours courts et lisibles, lumière du jour, accès jardin et unités de vie à échelle humaine.', interiors: 'Contrastes utiles à l’orientation, acoustique douce et espaces accueillants pour résidents, proches et personnel.', lasting: 'Préserver accessibilité, confort thermique, repères visuels et qualité des espaces communs.', adaptable: 'Prévoir mobilier, signalétique et chambres ajustables aux pratiques de soin.', vigilance: 'Valider avec résidents, soignants, exploitant et exigences sanitaires ; aucun décor ne compense un plan inadapté.' },
  housing: { architecture: 'Façades cohérentes avec le site et logements lumineux aux plans faciles à meubler.', interiors: 'Finitions sobres, rangements et pièces de vie adaptables aux ménages.', lasting: 'Soigner proportions, lumière naturelle et matériaux réparables.', adaptable: 'Permettre plusieurs usages d’une pièce et le renouvellement simple des finitions.', vigilance: 'Confronter typologies, entretien des parties communes et choix de façade aux ménages ciblés.' },
  clinic: { architecture: 'Flux patients, personnel et logistique séparés ; accès et orientation très lisibles.', interiors: 'Acoustique, éclairage et matières compatibles avec hygiène et soins.', lasting: 'Prioriser confort, accessibilité et maintenance des plateaux techniques.', adaptable: 'Prévoir des espaces reconfigurables selon les spécialités et équipements.', vigilance: 'La programmation dépend des spécialités, autorisations et protocoles d’exploitation.' },
  retail: { architecture: 'Façade identifiable, accès piétons et livraisons maîtrisés.', interiors: 'Parcours client clair et équipements remplaçables.', lasting: 'Conserver lisibilité, lumière et robustesse des zones à fort passage.', adaptable: 'Permettre l’évolution des rayonnages, enseignes et formats commerciaux.', vigilance: 'Faire valider les critères de l’enseigne, les flux et les autorisations commerciales.' },
  office: { architecture: 'Plateaux lumineux, divisibles et services communs accessibles.', interiors: 'Espaces de concentration et de collaboration avec confort acoustique.', lasting: 'Préserver une trame flexible et un bon confort visuel.', adaptable: 'Adapter cloisonnement et mobilier aux futurs utilisateurs.', vigilance: 'Mesurer demande placée, vacance et besoins des entreprises avant de figer les plateaux.' },
  student: { architecture: 'Studios compacts mais lumineux, espaces partagés visibles et sécurisés.', interiors: 'Mobilier robuste, rangements et lieux de travail calmes.', lasting: 'Soigner durabilité des finitions et qualité des espaces communs.', adaptable: 'Renouveler mobilier et services à chaque évolution des usages étudiants.', vigilance: 'Tester loyers accessibles, gestion, occupation annuelle et entretien intensif.' },
  other: { architecture: 'Volumes simples et cohérents avec le site, à confirmer selon l’usage.', interiors: 'Espaces confortables et facilement appropriables.', lasting: 'Privilégier lumière, proportions et matériaux réparables.', adaptable: 'Garder des espaces et finitions modifiables.', vigilance: 'Définir l’utilisateur, l’exploitation et les contraintes de ce programme avant de figer le style.' },
};

const FAMILIES: Record<StyleFamily, Omit<DesignDirection, 'family' | 'architecture' | 'interiors' | 'lasting' | 'adaptable' | 'vigilance' | 'sourceIds'>> = {
  durable: { title: 'Intemporel chaleureux', intent: 'Une base architecturale calme, ancrée dans le lieu et peu dépendante d’un effet de mode.',
    palette: [{ name: 'Craie', hex: '#E9E3D8', use: 'Fond lumineux' }, { name: 'Sable', hex: '#BCA992', use: 'Matière et menuiseries' }, { name: 'Brun profond', hex: '#55483E', use: 'Repères et détails' }],
    materials: ['Bois ou finition bois réparable', 'Enduit minéral adapté au site', 'Textiles remplaçables'] },
  contemporain: { title: 'Contemporain apaisé', intent: 'Une écriture nette et confortable, avec une palette mesurée et des espaces flexibles.',
    palette: [{ name: 'Ivoire', hex: '#F0EEE7', use: 'Fond et lumière' }, { name: 'Vert grisé', hex: '#8D9B8C', use: 'Repères et espaces communs' }, { name: 'Ardoise', hex: '#4A555A', use: 'Menuiseries et signalétique' }],
    materials: ['Pierre ou grès durable', 'Bois certifié selon disponibilité', 'Métal réparable'] },
  expressif: { title: 'Signature mesurée', intent: 'Une identité mémorable concentrée dans quelques éléments faciles à renouveler.',
    palette: [{ name: 'Écru', hex: '#ECE4D8', use: 'Base durable' }, { name: 'Bleu profond', hex: '#344E67', use: 'Accent identitaire' }, { name: 'Ocre', hex: '#BE7850', use: 'Signal ponctuel' }],
    materials: ['Support minéral sobre', 'Bois naturel', 'Textiles et objets facilement renouvelables'] },
};

/** Trois hypothèses locales de conception, sans prétendre lire ou prédire les contenus liés. */
export function buildDesignBrief(input: { programme: string; target: string; location: string; horizonYears: number; priority: string;
  sources: DesignSource[]; generatedAt?: string; strategy?: StrategyContext }): DesignBrief {
  const kind = programmeKind(input.programme), needs = KIND[kind];
  const directions = (['durable', 'contemporain', 'expressif'] as StyleFamily[]).map((family): DesignDirection => {
    const base = FAMILIES[family];
    return { ...base, family,
      architecture: [needs.architecture, family === 'expressif' ? 'Réserver l’expression forte aux détails que l’on peut changer.' : 'Vérifier implantation, façade et matériaux dans les règles locales.'],
      interiors: [needs.interiors, family === 'durable' ? 'Éviter les finitions trop dépendantes d’une saison.' : 'Tester les choix de couleur avec des utilisateurs représentatifs.'],
      lasting: [needs.lasting, `Priorité du porteur : ${input.priority}.`],
      adaptable: [needs.adaptable, 'Séparer éléments pérennes et décors remplaçables.'],
      vigilance: needs.vigilance,
      sourceIds: input.sources.filter((source) => source.family === family || source.id === 'levels-eu').map((source) => source.id),
    };
  });
  return { programme: input.programme, target: input.target, location: input.location, horizonYears: input.horizonYears,
    priority: input.priority, directions, selectedFamily: null, adjustments: '', generatedAt: input.generatedAt ?? new Date().toISOString(), method: 'local', strategy: input.strategy };
}

export function designBriefText(brief: DesignBrief, sources: DesignSource[]): string {
  const chosen = brief.directions.find((direction) => direction.family === brief.selectedFamily);
  if (!chosen) return 'Choisir une direction avant de créer le brief.';
  const linked = sources.filter((source) => chosen.sourceIds.includes(source.id));
  return [`BRIEF ARCHITECTURAL · ${brief.programme}`, `Lieu : ${brief.location}. Cible à tester : ${brief.target}. Horizon visé : ${brief.horizonYears} ans.`,
    `Direction choisie : ${chosen.title}. ${chosen.intent}`, `Palette : ${chosen.palette.map((color) => `${color.name} ${color.hex} (${color.use})`).join(' ; ')}.`,
    `Matériaux : ${chosen.materials.join(' ; ')}.`, `Architecture : ${chosen.architecture.join(' ; ')}.`, `Intérieurs : ${chosen.interiors.join(' ; ')}.`,
    `Choix pérennes : ${chosen.lasting.join(' ; ')}.`, `Éléments adaptables : ${chosen.adaptable.join(' ; ')}.`,
    `Points de vigilance : ${chosen.vigilance}`, brief.questionnaire?.length ? `Réponses du porteur : ${brief.questionnaire.map((item) => `${item.question} ${item.answer}`).join(' ; ')}.` : '',
    brief.rationale ? `Lecture de l’IA : ${brief.rationale}` : '',
    brief.checks?.length ? `À vérifier : ${brief.checks.join(' ; ')}.` : '', brief.adjustments ? `Ajustements du porteur : ${brief.adjustments}` : '',
    brief.strategy?.programmeDetail ? `Programme repris du dossier de décision : ${brief.strategy.programmeDetail}.` : '',
    brief.strategy?.facts.length ? `Contexte de marché (ces mesures ne prouvent pas les goûts de la cible) : ${brief.strategy.facts.map((fact) => `${fact.label} ${fact.value} · ${fact.scope} · ${fact.source} · ${fact.url}`).join(' ; ')}.` : '',
    brief.strategy?.pluZone ? `Zone PLU relevée : ${brief.strategy.pluZone}${brief.strategy.pluSource ? ` · source enregistrée : ${brief.strategy.pluSource}` : ''}. Règlement opposable à vérifier.` : '',
    brief.strategy?.envelope ? `Indications de gabarit extraites du dossier (non validées) : ${[
      brief.strategy.envelope.cesRatio != null ? `emprise ${Math.round(brief.strategy.envelope.cesRatio * 100)} %` : '',
      brief.strategy.envelope.heightM != null ? `hauteur ${brief.strategy.envelope.heightM} m` : '',
      brief.strategy.envelope.parkingPerHousing != null ? `stationnement ${brief.strategy.envelope.parkingPerHousing} place(s)/logement` : '',
    ].filter(Boolean).join(' ; ')}.` : '',
    `Références d’inspiration (elles ne prouvent pas une demande locale) : ${linked.map((source) => `${source.title} · ${source.scope} · ${source.url}`).join(' ; ') || 'aucune'}.`,
    'À vérifier : règlement PLU opposable, contraintes du site, faisabilité technique, entretien, budget et avis des utilisateurs/exploitants.'].filter(Boolean).join('\n\n');
}
