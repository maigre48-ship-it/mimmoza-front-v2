[1mdiff --git a/src/components/AppShell.tsx b/src/components/AppShell.tsx[m
[1mindex 63bee6be..806c41de 100644[m
[1m--- a/src/components/AppShell.tsx[m
[1m+++ b/src/components/AppShell.tsx[m
[36m@@ -3,6 +3,7 @@[m
 import {[m
   AlertTriangle,[m
   BarChart3,[m
[32m+[m[32m  Bot,[m
   Building,[m
   Building2,[m
   Calculator, ChevronRight,[m
[36m@@ -52,7 +53,7 @@[m [mimport { ProjectUnlockModal } from "./billing/ProjectUnlockModal";[m
 import { unlockProject } from "../lib/billing/projectUnlock";[m
 import { getSpacePaywallConfig } from "../lib/billing/paywallConfig";[m
 [m
[31m-type Space = "none" | "promoteur" | "agence" | "marchand" | "banque" | "rehabilitation";[m
[32m+[m[32mtype Space = "none" | "promoteur" | "agence" | "marchand" | "banque" | "rehabilitation" | "mimmozia";[m
 [m
 type AppShellProps = {[m
   currentSpace: Space;[m
[36m@@ -144,6 +145,7 @@[m [mfunction getSpaceGradient(space: Space): string {[m
   if (space === "agence")         return "linear-gradient(135deg, #16a34a 0%, #4ade80 100%)";[m
   if (space === "banque")         return "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";[m
   if (space === "rehabilitation") return "linear-gradient(90deg, #ea580c 0%, #fb923c 100%)";[m
[32m+[m[32m  if (space === "mimmozia")       return "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #d946ef 100%)";[m
   return "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";[m
 }[m
 [m
[36m@@ -153,6 +155,7 @@[m [mfunction getSpaceAccentColor(space: Space): string {[m
   if (space === "agence")         return "#16a34a";[m
   if (space === "banque")         return "#1a7a50";[m
   if (space === "rehabilitation") return "#ea580c";[m
[32m+[m[32m  if (space === "mimmozia")       return "#7c3aed";[m
   return "#1a72c4";[m
 }[m
 [m
[36m@@ -295,6 +298,7 @@[m [mconst SPACES: Array<{[m
   { id: "promoteur",      label: "Espace Promotion",         shortLabel: "Promotion",         description: "Faisabilite, SDP potentielle et bilan promoteur",         icon: Building2,  path: "/promoteur" },[m
   { id: "rehabilitation", label: "Espace Réhabilitation",    shortLabel: "Réhabilitation",    description: "Lecture de plan, conformité, chiffrage et valorisation",  icon: ScanSearch, path: "/rehabilitation" },[m
   { id: "agence",         label: "Espace Apport d'affaires", shortLabel: "Apport d'affaires", description: "Déposer un bien et générer des opportunités promoteur",   icon: Users,      path: "/apporteur" },[m
[32m+[m[32m  { id: "mimmozia",       label: "MimmozIA",                 shortLabel: "MimmozIA",          description: "Assistant IA connecté à toutes les sources immo",         icon: Bot,        path: "/mimmozia" },[m
 ];[m
 [m
 // ── SPACE_NAVIGATION ────────────────────────────────────────────────────────[m
[36m@@ -365,6 +369,8 @@[m [mconst SPACE_NAVIGATION: Record<Space, NavSection[]> = {[m
       ],[m
     },[m
   ],[m
[32m+[m[32m  // MimmozIA : chat plein écran, pas de sous-navigation. Tableau vide volontaire.[m
[32m+[m[32m  mimmozia: [],[m
   marchand: [[m
     {[m
       id: "acquisition",[m
[36m@@ -1055,6 +1061,11 @@[m [mexport function AppShell(props: AppShellProps) {[m
     location.pathname.startsWith("/politique-confidentialite") ||[m
     location.pathname.startsWith("/mentions-legales");[m
 [m
[32m+[m[32m  // MimmozIA : chat plein écran, le conteneur max-w-7xl l'étrangle.[m
[32m+[m[32m  const isFullWidthPage = location.pathname.startsWith("/mimmozia");[m
[32m+[m
[32m+[m[32m  useEffect(function () {[m
[32m+[m
   useEffect(function () {[m
     let mounted = true;[m
     async function refreshAdminStatus() {[m
[36m@@ -1238,13 +1249,13 @@[m [mexport function AppShell(props: AppShellProps) {[m
       )}[m
 [m
       <main className="flex-1 overflow-auto">[m
[31m-        {isPublicPage || isBarePage[m
[32m+[m[32m        {isPublicPage || isBarePage || isFullWidthPage[m
           ? children[m
           : <div className="mx-auto max-w-7xl px-4 lg:px-6">{children}</div>[m
         }[m
       </main>[m
 [m
[31m-      {!isBarePage && ([m
[32m+[m[32m      {!isBarePage && !isFullWidthPage && ([m
         <footer className="border-t border-slate-200/80 bg-white py-4 px-4">[m
           <div className="mx-auto max-w-7xl">[m
             <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">[m
