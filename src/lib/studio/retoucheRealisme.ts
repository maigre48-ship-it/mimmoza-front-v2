// INTÉGRATION DU 18/11/2026 — retouche photoréaliste de l'extension (machine de rendu, après un photomontage
// livrable) : ce que la carte de suivi du chat en dit. Pur. Aucun nom interne, aucune valeur inventée : seuls les
// contrôles présents dans `resultat.harmonisation` sont cités.

export interface ResumeRetoucheRealisme {
  readonly statut: 'harmonise' | 'non_harmonise' | 'desactive';
  readonly mention: string;
  readonly iou: number | null;
  /** Recouvrement minimal exigé, tel que la machine de rendu l'a appliqué (FINITIONS 18/11 : plus de chiffre écrit en dur ici). */
  readonly iouMin: number | null;
  readonly preuvePath: string | null;
}

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Lit `resultat.harmonisation` ; null si absent ou illisible. */
export function retoucheDuResultat(resultat: unknown): ResumeRetoucheRealisme | null {
  if (!estObj(resultat) || !estObj(resultat.harmonisation)) return null;
  const h = resultat.harmonisation;
  if (h.statut !== 'harmonise' && h.statut !== 'non_harmonise' && h.statut !== 'desactive') return null;
  const mention = typeof h.mention === 'string' ? h.mention.slice(0, 300) : '';
  const c = estObj(h.controles) ? h.controles : {};
  return { statut: h.statut, mention, iou: num(c.iou), iouMin: num(h.iou_min), preuvePath: typeof h.preuve_path === 'string' ? h.preuve_path : null };
}

const pourcent = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('fr-FR')} %`;

/** Lignes de détail de la carte de suivi (rien quand la retouche n'est pas installée). */
export function lignesRetoucheRealisme(resultat: unknown): string[] {
  const r = retoucheDuResultat(resultat);
  if (!r || r.statut === 'desactive') return [];
  const l: string[] = [];
  if (r.mention) l.push(r.mention);
  if (r.statut === 'harmonise' && r.iou !== null) {
    const minimum = r.iouMin !== null ? ` (minimum exigé : ${pourcent(r.iouMin)})` : '';
    l.push(`Contrôle après retouche : la forme retouchée recouvre ${pourcent(r.iou)} de celle du projet calculé${minimum}.`);
  }
  return l;
}
