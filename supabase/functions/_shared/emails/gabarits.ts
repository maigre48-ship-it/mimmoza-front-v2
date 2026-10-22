// supabase/functions/_shared/emails/gabarits.ts
// =============================================================================
// E-MAILS DE CYCLE DE VIE — GABARITS HTML + TEXTE (logique PURE, sans import)
// =============================================================================
//
// Contraintes des clients de messagerie (Gmail, Outlook bureau/web, Apple Mail,
// Thunderbird, mobiles) :
//   · mise en page en <table>, largeur 600 px, styles EN LIGNE uniquement ;
//   · bouton « à l'épreuve des balles » : cellule colorée (bgcolor) + lien ;
//   · aucune image indispensable : le logo a un texte de remplacement, le nom
//     « Mimmoza » est aussi écrit en clair à côté ;
//   · police système (Arial/Helvetica en repli) ; pas de CSS externe, pas de JS ;
//   · une version texte brut équivalente, toujours.
//
// Aucune donnée inventée : les gabarits n'affichent que les valeurs passées
// (compteurs réels lus par la fonction emails-cycle-vie).
// =============================================================================

import {
  type CodeFormule,
  type TypeEmail,
  ANALYSES_INCLUSES,
  JETONS_PAR_ANALYSE,
  NOM_FORMULE_EMAIL,
  estTransactionnel,
} from "./regles.ts";

export const VIOLET = "#5b4bd6";
const ENCRE = "#1f2147";
const GRIS = "#5f6480";
const FOND = "#f4f4fa";

export interface DonneesEmail {
  /** URL publique de l'application, sans barre finale (ex. https://mimmoza.vercel.app). */
  appUrl: string;
  prenom?: string | null;
  formule: CodeFormule;
  /** Analyses rapides incluses consommées ce mois-ci. */
  analysesMois?: number;
  soldeJetons?: number | null;
  /** Conversation de la première analyse (pour le lien direct). */
  conversationId?: string | null;
  /** Lien de désinscription (obligatoire pour un e-mail non transactionnel). */
  lienDesinscription?: string | null;
  /** Adresse de contact affichée. */
  contact?: string;
  /** Date de référence (calcul du « 1er du mois prochain »). */
  maintenant?: Date;
}

export interface EmailRendu {
  sujet: string;
  preheader: string;
  html: string;
  texte: string;
}

/** Échappement HTML (prénom, valeurs libres). */
export function echapper(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nombre(n: number): string {
  // Espace fine insécable comme séparateur de milliers (lisible partout).
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function premierDuMoisProchain(d: Date): string {
  const mois = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  const m = (d.getUTCMonth() + 1) % 12;
  return `1er\u00a0${mois[m]}`;
}

/** Un bloc de contenu : paragraphes, liste à puces, bouton. */
type Bloc =
  | { t: "p"; texte: string; html?: string }
  | { t: "liste"; items: { texte: string; html?: string }[] }
  | { t: "bouton"; libelle: string; url: string }
  | { t: "encadre"; texte: string; html?: string };

interface Contenu {
  sujet: string;
  preheader: string;
  titre: string;
  blocs: Bloc[];
  /** Raison de l'envoi, affichée en pied de page. */
  raison: string;
}

function salutation(prenom?: string | null): string {
  const p = (prenom ?? "").trim();
  return p ? `Bonjour ${p},` : "Bonjour,";
}

function contenu(type: TypeEmail, d: DonneesEmail): Contenu {
  const app = d.appUrl.replace(/\/+$/, "");
  const nomFormule = NOM_FORMULE_EMAIL[d.formule];
  const quota = ANALYSES_INCLUSES[d.formule];
  const contact = d.contact ?? "contact@mimmoza.fr";
  const maintenant = d.maintenant ?? new Date();
  const solde = d.soldeJetons ?? 0;

  switch (type) {
    case "bienvenue":
      return {
        sujet: "Bienvenue sur Mimmoza — par quoi commencer",
        preheader: "Une adresse suffit pour lancer votre première analyse.",
        titre: "Bienvenue sur Mimmoza",
        raison: "Vous recevez cet e-mail parce que vous venez de confirmer votre compte Mimmoza.",
        blocs: [
          { t: "p", texte: salutation(d.prenom) },
          {
            t: "p",
            texte:
              "Votre compte est actif. Mimmoza réunit les données publiques (cadastre, PLU, risques, marché) " +
              "et Mimmo, l'assistant, les analyse pour vous en quelques secondes.",
          },
          { t: "p", texte: "Pour bien démarrer, essayez l'une de ces trois demandes :" },
          {
            t: "liste",
            items: [
              { texte: "Analyser une adresse : règles du PLU, contraintes, risques et potentiel." },
              { texte: "Évaluer une opération : un bilan simplifié à partir de vos hypothèses." },
              { texte: "Créer une maquette 3D : décrivez un bâtiment, Mimmo prépare le volume." },
            ],
          },
          {
            t: "encadre",
            texte:
              `Votre formule ${nomFormule} inclut ${nombre(quota)} analyses rapides par mois` +
              (d.formule === "basique" ? " et 10 messages à Mimmo." : "."),
          },
          { t: "bouton", libelle: "Lancer ma première analyse", url: `${app}/mimmozia` },
          {
            t: "p",
            texte: `Une question ? Le centre d'aide est ici : ${app}/aide — ou répondez simplement à cet e-mail.`,
            html:
              `Une question ? Consultez le <a href="${app}/aide" style="color:${VIOLET};">centre d'aide</a> ` +
              "ou répondez simplement à cet e-mail.",
          },
        ],
      };

    case "premiere_analyse": {
      const lien = d.conversationId
        ? `${app}/mimmozia?conversation=${encodeURIComponent(d.conversationId)}`
        : `${app}/mimmozia`;
      return {
        sujet: "Votre première analyse est prête",
        preheader: "Retrouvez-la dans votre historique et exportez-la en PDF.",
        titre: "Votre première analyse est prête",
        raison: "Vous recevez cet e-mail parce que vous avez lancé votre première analyse sur Mimmoza.",
        blocs: [
          { t: "p", texte: salutation(d.prenom) },
          {
            t: "p",
            texte:
              "Votre première analyse est enregistrée dans votre historique. Vous pouvez la rouvrir à tout moment, " +
              "poser des questions de suivi à Mimmo et l'exporter en PDF.",
          },
          { t: "bouton", libelle: "Ouvrir mon analyse", url: lien },
          { t: "p", texte: "Pour aller plus loin :" },
          {
            t: "liste",
            items: [
              { texte: "Exportez la réponse en PDF (bouton « PDF » sous la réponse)." },
              { texte: "Demandez un bilan simplifié de l'opération à Mimmo." },
              { texte: "Visualisez le projet en 3D depuis la conversation." },
            ],
          },
        ],
      };
    }

    case "rappel_sans_analyse":
      return {
        sujet: "Votre première analyse vous attend",
        preheader: "Une adresse suffit : règles d'urbanisme, risques et potentiel en quelques secondes.",
        titre: "Votre première analyse vous attend",
        raison: "Vous recevez cet e-mail parce que vous avez créé un compte Mimmoza il y a quelques jours.",
        blocs: [
          { t: "p", texte: salutation(d.prenom) },
          {
            t: "p",
            texte:
              "Vous avez créé votre compte Mimmoza il y a quelques jours, sans lancer d'analyse pour l'instant. " +
              "Il suffit d'une adresse ou d'une référence cadastrale.",
          },
          { t: "p", texte: "Quelques exemples de demandes à copier dans Mimmo :" },
          {
            t: "liste",
            items: [
              { texte: "« Analyse cette adresse : faisabilité, contraintes et potentiel — [votre adresse] »" },
              { texte: "« Quelles sont les règles du PLU sur la parcelle [référence cadastrale] ? »" },
              { texte: "« Prépare une maquette 3D d'un immeuble R+3 de 12 logements »" },
            ],
          },
          {
            t: "encadre",
            texte: `Votre formule ${nomFormule} inclut ${nombre(quota)} analyses rapides par mois.`,
          },
          { t: "bouton", libelle: "Lancer une analyse", url: `${app}/mimmozia` },
        ],
      };

    case "quota_80": {
      const n = d.analysesMois ?? 0;
      return {
        sujet: `Vous avez utilisé ${nombre(n)} de vos ${nombre(quota)} analyses rapides du mois`,
        preheader: "Ce qui se passe ensuite, et comment continuer.",
        titre: "Votre quota d'analyses rapides arrive à son terme",
        raison: "Vous recevez cet e-mail parce que vous avez utilisé au moins 80\u00a0% des analyses incluses dans votre formule.",
        blocs: [
          { t: "p", texte: salutation(d.prenom) },
          {
            t: "p",
            texte:
              `Vous avez utilisé ${nombre(n)} des ${nombre(quota)} analyses rapides incluses ce mois-ci ` +
              `dans votre formule ${nomFormule}.`,
          },
          {
            t: "encadre",
            texte:
              `Ensuite : chaque analyse rapide supplémentaire est décomptée de ${JETONS_PAR_ANALYSE} jetons ` +
              `sur votre solde (1 jeton = 0,10\u00a0€\u00a0HT). Le compteur repart à zéro le ${premierDuMoisProchain(maintenant)}.`,
          },
          { t: "bouton", libelle: "Voir les formules", url: `${app}/tarifs` },
        ],
      };
    }

    case "quota_100":
      return {
        sujet: "Vos analyses rapides incluses ce mois-ci sont utilisées",
        preheader: `Les suivantes sont décomptées de ${JETONS_PAR_ANALYSE} jetons chacune.`,
        titre: "Analyses rapides du mois : quota atteint",
        raison: "Vous recevez cet e-mail parce que le quota d'analyses de votre formule est atteint (information liée à votre compte).",
        blocs: [
          { t: "p", texte: salutation(d.prenom) },
          {
            t: "p",
            texte:
              `Les ${nombre(quota)} analyses rapides incluses dans votre formule ${nomFormule} ont été utilisées ce mois-ci.`,
          },
          {
            t: "encadre",
            texte:
              `Ce qui se passe maintenant : chaque nouvelle analyse rapide est décomptée de ${JETONS_PAR_ANALYSE} jetons ` +
              `(1\u00a0€\u00a0HT). Votre solde actuel : ${nombre(solde)} jetons. ` +
              `De nouvelles analyses incluses seront disponibles le ${premierDuMoisProchain(maintenant)}.`,
          },
          {
            t: "p",
            texte:
              `Le paiement en ligne arrive bientôt : pour recharger des jetons ou changer de formule dès maintenant, ` +
              `écrivez-nous à ${contact}.`,
          },
          { t: "bouton", libelle: "Voir les formules et les packs", url: `${app}/tarifs` },
        ],
      };

    case "solde_bas":
      return {
        sujet: `Votre solde de jetons est bas (${nombre(solde)} jetons)`,
        preheader: "Les analyses incluses dans votre formule restent disponibles.",
        titre: "Votre solde de jetons est bas",
        raison: "Vous recevez cet e-mail parce que votre solde de jetons est passé sous 30 jetons.",
        blocs: [
          { t: "p", texte: salutation(d.prenom) },
          {
            t: "p",
            texte:
              `Il vous reste ${nombre(solde)} jetons. Les jetons servent aux demandes avancées à Mimmo et aux ` +
              `analyses rapides au-delà de votre quota (${JETONS_PAR_ANALYSE} jetons par analyse).`,
          },
          {
            t: "encadre",
            texte:
              `Les ${nombre(quota)} analyses rapides incluses chaque mois dans votre formule ${nomFormule} ` +
              "ne consomment pas de jetons.",
          },
          {
            t: "p",
            texte:
              `Le paiement en ligne arrive bientôt : pour une recharge dès maintenant, écrivez-nous à ${contact}.`,
          },
          { t: "bouton", libelle: "Voir les packs de jetons", url: `${app}/tarifs` },
        ],
      };
  }
}

// ── Rendu ────────────────────────────────────────────────────────────────────

function blocHtml(b: Bloc): string {
  switch (b.t) {
    case "p":
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${ENCRE};">${b.html ?? echapper(b.texte)}</p>`;
    case "liste":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">` +
        b.items
          .map(
            (i) =>
              `<tr><td valign="top" width="22" style="padding:0 0 8px;font-size:15px;line-height:1.6;color:${VIOLET};font-weight:bold;">&#8226;</td>` +
              `<td style="padding:0 0 8px;font-size:15px;line-height:1.6;color:${ENCRE};">${i.html ?? echapper(i.texte)}</td></tr>`,
          )
          .join("") +
        `</table>`
      );
    case "encadre":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">` +
        `<tr><td style="padding:14px 16px;background-color:#f1eeff;border-left:4px solid ${VIOLET};font-size:14px;line-height:1.55;color:${ENCRE};">` +
        `${b.html ?? echapper(b.texte)}</td></tr></table>`
      );
    case "bouton":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;">` +
        `<tr><td align="center" bgcolor="${VIOLET}" style="border-radius:8px;background-color:${VIOLET};">` +
        `<a href="${echapper(b.url)}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:Arial,Helvetica,sans-serif;` +
        `font-size:15px;font-weight:bold;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;">${echapper(b.libelle)}</a>` +
        `</td></tr></table>`
      );
  }
}

function blocTexte(b: Bloc): string {
  switch (b.t) {
    case "p":
      return b.texte;
    case "liste":
      return b.items.map((i) => `  - ${i.texte}`).join("\n");
    case "encadre":
      return `> ${b.texte}`;
    case "bouton":
      return `${b.libelle} : ${b.url}`;
  }
}

export function rendreEmail(type: TypeEmail, d: DonneesEmail): EmailRendu {
  const c = contenu(type, d);
  const app = d.appUrl.replace(/\/+$/, "");
  const transactionnel = estTransactionnel(type);
  if (!transactionnel && !d.lienDesinscription) {
    throw new Error(`Lien de désinscription manquant pour l'e-mail non transactionnel « ${type} ».`);
  }

  const piedHtml =
    `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${GRIS};">${echapper(c.raison)}</p>` +
    (transactionnel
      ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${GRIS};">Cet e-mail est lié au fonctionnement de votre compte : il ne peut pas être désactivé.</p>`
      : `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${GRIS};">` +
        `<a href="${echapper(d.lienDesinscription!)}" style="color:${GRIS};text-decoration:underline;">Ne plus recevoir ce type d'e-mails</a></p>`) +
    `<p style="margin:0;font-size:12px;line-height:1.5;color:${GRIS};">Mimmoza — analyse immobilière pour les professionnels · ` +
    `<a href="${app}" style="color:${GRIS};text-decoration:underline;">${echapper(app.replace(/^https?:\/\//, ""))}</a></p>`;

  const html =
    `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${echapper(c.sujet)}</title>
</head>
<body style="margin:0;padding:0;background-color:${FOND};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${FOND};">${echapper(c.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${FOND}" style="background-color:${FOND};">
<tr><td align="center" style="padding:28px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="padding:0 4px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px;"><img src="${app}/icons/mimmoza-192.png" width="36" height="36" alt="Mimmoza" style="display:block;border:0;border-radius:9px;"></td>
<td valign="middle" style="font-size:20px;font-weight:bold;color:${VIOLET};letter-spacing:-0.3px;">Mimmoza</td>
</tr></table>
</td></tr>
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:14px;border-top:5px solid ${VIOLET};padding:30px 30px 14px;">
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:${ENCRE};font-weight:bold;">${echapper(c.titre)}</h1>
${c.blocs.map(blocHtml).join("\n")}
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${ENCRE};">L'équipe Mimmoza</p>
</td></tr>
<tr><td style="padding:18px 8px 0;">
${piedHtml}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const texte = [
    c.titre.toUpperCase(),
    "",
    ...c.blocs.map((b) => blocTexte(b) + "\n"),
    "L'équipe Mimmoza",
    "",
    "--",
    c.raison,
    transactionnel
      ? "Cet e-mail est lié au fonctionnement de votre compte : il ne peut pas être désactivé."
      : `Ne plus recevoir ce type d'e-mails : ${d.lienDesinscription}`,
    `Mimmoza — ${app}`,
  ].join("\n");

  return { sujet: c.sujet, preheader: c.preheader, html, texte };
}
