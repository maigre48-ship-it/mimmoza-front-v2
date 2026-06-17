// ============================================================================
// DossierContextBar.tsx — DEPRECATED (shim)
// ============================================================================
// La navigation Banque est gérée par BanqueLayout.
// Ce composant est conservé comme shim vide pour compatibilité d'import.
// ============================================================================

type Props = {
  dossierId?: string | null;
  dossier?: any;
};

/** @deprecated Utiliser BanqueLayout à la place. */
export default function DossierContextBar(_props: Props) {
  return null;
}