// src/spaces/admin/pages/agentCommercial/csvMapping.ts
// Champs importables + auto-détection du mapping colonnes CSV → champ prospect.

export const IMPORT_FIELDS = [
  { key: "company_name", label: "Raison sociale", required: true },
  { key: "first_name", label: "Prénom", required: false },
  { key: "last_name", label: "Nom", required: false },
  { key: "job_title", label: "Fonction", required: false },
  { key: "email", label: "Email", required: false },
  { key: "phone", label: "Téléphone", required: false },
  { key: "website", label: "Site web", required: false },
  { key: "city", label: "Ville", required: false },
  { key: "department", label: "Département", required: false },
  { key: "zone", label: "Zone", required: false },
  { key: "company_type", label: "Type d'entreprise", required: false },
  { key: "company_size", label: "Taille", required: false },
  { key: "notes", label: "Notes", required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

// mapping : champ prospect → nom de colonne CSV (ou "" si non mappé)
export type ColumnMapping = Record<ImportFieldKey, string>;

const SYNONYMS: Record<ImportFieldKey, string[]> = {
  company_name: ["raison sociale", "raisonsociale", "societe", "entreprise", "company", "companyname", "company name", "nom entreprise"],
  first_name: ["prenom", "firstname", "first name", "first"],
  last_name: ["nom", "lastname", "last name", "last", "name"],
  job_title: ["fonction", "poste", "titre", "job", "title", "jobtitle"],
  email: ["email", "e-mail", "mail", "courriel", "adresse email"],
  phone: ["telephone", "tel", "phone", "portable", "mobile"],
  website: ["site", "site web", "website", "url", "web"],
  city: ["ville", "city", "commune"],
  department: ["departement", "dept", "dep", "department"],
  zone: ["zone", "region", "secteur"],
  company_type: ["type", "type entreprise", "type d'entreprise", "company type"],
  company_size: ["taille", "effectif", "size", "company size"],
  notes: ["notes", "note", "commentaire", "remarque", "observations"],
};

/** Minuscule + suppression des accents (diacritiques) pour comparer les en-têtes. */
function normalizeHeader(h: string): string {
  return h.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

/** Devine le mapping à partir des en-têtes détectés. */
export function autoMap(headers: string[]): ColumnMapping {
  const norm = headers.map((h) => ({ raw: h, n: normalizeHeader(h) }));
  const mapping = {} as ColumnMapping;

  for (const field of IMPORT_FIELDS) {
    const syns = SYNONYMS[field.key];
    const found = norm.find((h) => syns.includes(h.n));
    mapping[field.key] = found ? found.raw : "";
  }
  return mapping;
}
