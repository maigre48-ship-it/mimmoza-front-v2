# Spec test (safe)
Objectif: Ajouter une page statique "AITest" dans src/pages/AITest.tsx
- Doit être une simple page React export default
- Ne modifier aucun routing, aucun menu, aucun composant existant
- C'est uniquement un test de génération
Définition de fini:
- Un nouveau fichier src/pages/AITest.tsx est créé
- Le build ne doit pas être impacté (mais on n'applique pas le patch dans ce test)
