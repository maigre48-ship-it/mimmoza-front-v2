{
  "$schema": "ResolvedPluRulesetV1",
  "$version": "1.0.1",

  "_comment_general": "Schéma PLU zone-only pour moteur d'implantation 2D. Aucun champ n'est bloquant : completeness.ok est un indicateur de qualité, pas un verrou. Le système fonctionne en best effort avec warnings UI et saisie manuelle possible.",

  "_definitions": {
    "ValueWithSource<T>": {
      "_comment": "Structure standard OBLIGATOIRE pour tout champ quantitatif, booléen ou enum décisionnel.",
      "value": "T | null — Valeur exploitable. null = donnée absente ou ambiguë.",
      "source": "'AI' | 'MANUAL' | 'DERIVED' | 'UNKNOWN' — Origine de la valeur.",
      "note": "string | null — OBLIGATOIRE si value=null OU source='MANUAL'.",
      "citations": "[{ page: number|null, snippet: string|null }] | null — Références au règlement source. Format fixe."
    }
  },

  "metadata": {
    "_comment": "Informations de traçabilité et contexte. NON ESSENTIEL pour l'implantation.",
    "_essential": false,

    "zoneCode": {
      "_comment": "Identifiant réglementaire de la zone (ex: UB, UC, 1AUe). OBLIGATOIRE pour identification.",
      "type": "string",
      "example": "UB"
    },

    "zoneLabel": {
      "_comment": "Nom complet ou description de la zone.",
      "type": "string | null",
      "example": "Zone urbaine mixte à dominante résidentielle"
    },

    "communeInsee": {
      "_comment": "Code INSEE de la commune.",
      "type": "string | null",
      "example": "69123"
    },

    "communeName": {
      "_comment": "Nom de la commune.",
      "type": "string | null",
      "example": "Lyon"
    },

    "documentSource": {
      "_comment": "Référence au document PLU source (nom, date approbation, version).",
      "type": "string | null",
      "example": "PLU-H Métropole de Lyon, approuvé 13/05/2019, modif. 07/2023"
    },

    "extractionDate": {
      "_comment": "Date d'extraction des règles.",
      "type": "string | null",
      "format": "ISO 8601 (YYYY-MM-DD)",
      "example": "2025-01-15"
    },

    "extractionNotes": {
      "_comment": "Notes générales sur l'extraction ou ambiguïtés globales rencontrées.",
      "type": "string | null"
    }
  },

  "implantationVoirie": {
    "_comment": "Règles d'implantation par rapport aux voies et emprises publiques (Article 6 PLU).",
    "_essential": true,

    "alignement": {
      "_comment": "Mode d'implantation par rapport à l'alignement. ESSENTIEL.",
      "_essential": true,

      "mode": {
        "_comment": "OBLIGATOIRE = alignement imposé (recul implicite = 0). AUTORISE = alignement possible mais non imposé. INTERDIT = recul obligatoire. INCONNU = règle non déterminée.",
        "value": {
          "type": "string | null",
          "enum": ["OBLIGATOIRE", "AUTORISE", "INTERDIT", "INCONNU"]
        },
        "source": {
          "type": "string",
          "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
        },
        "note": {
          "type": "string | null",
          "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'"
        },
        "citations": {
          "type": "array | null",
          "items": {
            "page": "number | null",
            "snippet": "string | null"
          }
        }
      }
    },

    "reculMinimal": {
      "_comment": "Distance minimale de recul par rapport à l'alignement (mètres). ESSENTIEL sauf si alignement.mode='OBLIGATOIRE'.",
      "_essential": "conditional — requis si alignement.mode ≠ 'OBLIGATOIRE'",

      "value": {
        "type": "number | null",
        "unit": "m",
        "min": 0,
        "example": 5.0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null",
        "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "reculMaximal": {
      "_comment": "Distance maximale de recul si bande d'implantation définie. NON ESSENTIEL.",
      "_essential": false,

      "value": {
        "type": "number | null",
        "unit": "m",
        "min": 0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "conditionsParticulieres": {
      "_comment": "Texte libre pour règles spécifiques (ex: recul différent selon largeur voie, angle de parcelle). NON ESSENTIEL.",
      "_essential": false,
      "type": "string | null"
    }
  },

  "implantationLimitesSeparatives": {
    "_comment": "Règles d'implantation par rapport aux limites séparatives latérales (Article 7 PLU).",
    "_essential": true,

    "implantationEnLimite": {
      "_comment": "Mode d'implantation par rapport aux limites séparatives latérales. ESSENTIEL.",
      "_essential": true,

      "mode": {
        "_comment": "OBLIGATOIRE = en limite imposée sur au moins un côté. AUTORISE = en limite possible. INTERDIT = retrait obligatoire des deux côtés. INCONNU = règle non déterminée.",
        "value": {
          "type": "string | null",
          "enum": ["OBLIGATOIRE", "AUTORISE", "INTERDIT", "INCONNU"]
        },
        "source": {
          "type": "string",
          "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
        },
        "note": {
          "type": "string | null",
          "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'"
        },
        "citations": {
          "type": "array | null",
          "items": {
            "page": "number | null",
            "snippet": "string | null"
          }
        }
      }
    },

    "reculMinimalSiRetrait": {
      "_comment": "Distance minimale de retrait si construction non en limite (mètres). ESSENTIEL si mode ≠ 'OBLIGATOIRE'.",
      "_essential": "conditional — requis si implantationEnLimite.mode ∈ {'AUTORISE', 'INTERDIT', 'INCONNU'}",

      "value": {
        "type": "number | null",
        "unit": "m",
        "min": 0,
        "example": 3.0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null",
        "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "reculProportionnelHauteur": {
      "_comment": "Recul calculé proportionnellement à la hauteur de la construction. Permet dérivation du recul effectif.",
      "_essential": false,
      "_derivable": true,

      "formule": {
        "_comment": "Expression du ratio (ex: 'H/2', '0.5*H', 'H-3'). null si non applicable.",
        "value": {
          "type": "string | null",
          "example": "H/2"
        },
        "source": {
          "type": "string",
          "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
        },
        "note": {
          "type": "string | null"
        },
        "citations": {
          "type": "array | null",
          "items": {
            "page": "number | null",
            "snippet": "string | null"
          }
        }
      },

      "minimum": {
        "_comment": "Valeur plancher (mètres) appliquée même si le calcul H/x donne moins.",
        "value": {
          "type": "number | null",
          "unit": "m",
          "min": 0,
          "example": 3.0
        },
        "source": {
          "type": "string",
          "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
        },
        "note": {
          "type": "string | null"
        },
        "citations": {
          "type": "array | null",
          "items": {
            "page": "number | null",
            "snippet": "string | null"
          }
        }
      }
    },

    "conditionsParticulieres": {
      "_comment": "Texte libre pour règles spécifiques (ex: selon destination, hauteur en limite réduite). NON ESSENTIEL.",
      "_essential": false,
      "type": "string | null"
    }
  },

  "implantationFondParcelle": {
    "_comment": "Règles d'implantation par rapport au fond de parcelle (souvent traité dans Article 7 étendu).",
    "_essential": true,

    "identiqueLimitesSeparatives": {
      "_comment": "Indique si les règles du fond sont identiques aux limites séparatives latérales. Permet dérivation automatique.",
      "_essential": false,
      "_enables_derivation": true,

      "value": {
        "type": "boolean | null"
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null",
        "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "implantationEnLimite": {
      "_comment": "Mode d'implantation par rapport à la limite de fond. ESSENTIEL (ou dérivé si identiqueLimitesSeparatives=true).",
      "_essential": true,
      "_derivable_from": "implantationLimitesSeparatives.implantationEnLimite si identiqueLimitesSeparatives.value=true",

      "mode": {
        "_comment": "OBLIGATOIRE = en limite imposée. AUTORISE = en limite possible. INTERDIT = recul obligatoire. INCONNU = règle non déterminée.",
        "value": {
          "type": "string | null",
          "enum": ["OBLIGATOIRE", "AUTORISE", "INTERDIT", "INCONNU"]
        },
        "source": {
          "type": "string",
          "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
        },
        "note": {
          "type": "string | null",
          "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'"
        },
        "citations": {
          "type": "array | null",
          "items": {
            "page": "number | null",
            "snippet": "string | null"
          }
        }
      }
    },

    "reculMinimal": {
      "_comment": "Distance minimale de recul par rapport au fond de parcelle (mètres). ESSENTIEL si mode ≠ 'OBLIGATOIRE'.",
      "_essential": "conditional — requis si implantationEnLimite.mode ≠ 'OBLIGATOIRE'",
      "_derivable_from": "implantationLimitesSeparatives.reculMinimalSiRetrait si identiqueLimitesSeparatives.value=true",

      "value": {
        "type": "number | null",
        "unit": "m",
        "min": 0,
        "example": 6.0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null",
        "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "conditionsParticulieres": {
      "_comment": "Texte libre pour règles spécifiques. NON ESSENTIEL.",
      "_essential": false,
      "type": "string | null"
    }
  },

  "empriseAuSol": {
    "_comment": "Coefficient d'Emprise au Sol (Article 9 PLU).",
    "_essential": true,

    "ces": {
      "_comment": "CES en ratio normalisé 0..1. ESSENTIEL. Exemple: 0.6 = 60%. Si le règlement est en %, indiquer la valeur brute dans note.",
      "_essential": true,

      "value": {
        "type": "number | null",
        "format": "ratio 0..1",
        "min": 0,
        "max": 1,
        "example": 0.6
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null",
        "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'. Mentionner valeur brute si extraction depuis %.",
        "example": "Règlement: 60%"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "empriseMaximaleAbsolue": {
      "_comment": "Surface maximale absolue d'emprise en m² si applicable. NON ESSENTIEL.",
      "_essential": false,

      "value": {
        "type": "number | null",
        "unit": "m2",
        "min": 0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "exclusions": {
      "_comment": "Éléments exclus du calcul de l'emprise (texte libre). NON ESSENTIEL.",
      "_essential": false,
      "type": "string | null",
      "example": "Piscines et annexes < 20m² non comptabilisées"
    }
  },

  "hauteur": {
    "_comment": "Règles de hauteur maximale (Article 10 PLU). NON ESSENTIEL pour implantation 2D pure, mais ESSENTIEL si recul H/x utilisé.",
    "_essential": false,
    "_essential_if": "implantationLimitesSeparatives.reculProportionnelHauteur.formule.value ≠ null",

    "hauteurMaximale": {
      "_comment": "Hauteur maximale autorisée. NON ESSENTIEL pour 2D, génère WARNING si absent et H/x requis.",
      "_essential": false,

      "value": {
        "type": "number | null",
        "unit": "m",
        "min": 0,
        "example": 12.0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null",
        "_constraint": "OBLIGATOIRE si value=null OU source='MANUAL'"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "modeCalcul": {
      "_comment": "Point de référence pour le calcul de la hauteur. NON ESSENTIEL.",
      "_essential": false,

      "value": {
        "type": "string | null",
        "enum": ["FAITAGE", "ACROTERE", "EGOUT_TOITURE", "PLAFOND_DERNIER_NIVEAU", "AUTRE"]
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "hauteurFacadeMaximale": {
      "_comment": "Hauteur maximale à l'égout ou à l'acrotère si distincte du faîtage. NON ESSENTIEL.",
      "_essential": false,

      "value": {
        "type": "number | null",
        "unit": "m",
        "min": 0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "nombreNiveauxMaximal": {
      "_comment": "Nombre maximal de niveaux (R+n). NON ESSENTIEL, informatif.",
      "_essential": false,

      "value": {
        "type": "integer | null",
        "min": 0,
        "example": 3
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null",
        "example": "R+2+combles"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "conditionsParticulieres": {
      "_comment": "Texte libre pour règles spécifiques (gabarit enveloppe, hauteur en limite réduite). NON ESSENTIEL.",
      "_essential": false,
      "type": "string | null"
    }
  },

  "stationnement": {
    "_comment": "Obligations de stationnement (Article 12 PLU). NON ESSENTIEL pour géométrie 2D.",
    "_essential": false,

    "vehicules": {
      "_comment": "Règles de stationnement véhicules.",

      "ratioLogement": {
        "_comment": "Nombre de places par logement.",
        "value": {
          "type": "number | null",
          "min": 0,
          "example": 1.5
        },
        "source": {
          "type": "string",
          "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
        },
        "note": {
          "type": "string | null"
        },
        "citations": {
          "type": "array | null",
          "items": {
            "page": "number | null",
            "snippet": "string | null"
          }
        }
      },

      "ratioSurfacePlancher": {
        "_comment": "Nombre de places par tranche de surface de plancher.",
        "value": {
          "type": "number | null",
          "min": 0
        },
        "parTranche_m2": {
          "_comment": "Surface de plancher correspondant à une place (m²).",
          "type": "number | null",
          "example": 60
        },
        "source": {
          "type": "string",
          "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
        },
        "note": {
          "type": "string | null"
        },
        "citations": {
          "type": "array | null",
          "items": {
            "page": "number | null",
            "snippet": "string | null"
          }
        }
      },

      "conditionsParticulieres": {
        "_comment": "Règles spécifiques (réduction proximité transports, mutualisation). NON ESSENTIEL.",
        "type": "string | null"
      }
    },

    "velos": {
      "_comment": "Règles de stationnement vélos.",

      "obligatoire": {
        "value": {
          "type": "boolean | null"
        },
        "source": {
          "type": "string",
          "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
        },
        "note": {
          "type": "string | null"
        },
        "citations": {
          "type": "array | null",
          "items": {
            "page": "number | null",
            "snippet": "string | null"
          }
        }
      },

      "ratio": {
        "_comment": "Ratio ou surface minimale dédiée (texte libre).",
        "type": "string | null",
        "example": "1.5 m² / logement"
      }
    }
  },

  "reglesComplementaires": {
    "_comment": "Règles additionnelles pouvant impacter l'implantation. NON ESSENTIEL.",
    "_essential": false,

    "distanceEntreConstructions": {
      "_comment": "Distance minimale entre bâtiments sur une même parcelle (Article 8). NON ESSENTIEL pour implantation simple bâtiment.",
      "_essential": false,

      "value": {
        "type": "number | null",
        "unit": "m",
        "min": 0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "espaceLibrePleineTerre": {
      "_comment": "Pourcentage minimal d'espace libre ou pleine terre (Article 13). Stocké en ratio 0..1. NON ESSENTIEL.",
      "_essential": false,

      "value": {
        "type": "number | null",
        "format": "ratio 0..1",
        "min": 0,
        "max": 1
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null",
        "example": "Règlement: 30%"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "surfaceMinimaleParcelle": {
      "_comment": "Surface minimale de terrain pour construire. NON ESSENTIEL.",
      "_essential": false,

      "value": {
        "type": "number | null",
        "unit": "m2",
        "min": 0
      },
      "source": {
        "type": "string",
        "enum": ["AI", "MANUAL", "DERIVED", "UNKNOWN"]
      },
      "note": {
        "type": "string | null"
      },
      "citations": {
        "type": "array | null",
        "items": {
          "page": "number | null",
          "snippet": "string | null"
        }
      }
    },

    "autresContraintes": {
      "_comment": "Toute autre contrainte textuelle (bande constructible, prospect, servitudes). NON ESSENTIEL.",
      "_essential": false,
      "type": "string | null"
    }
  },

  "completeness": {
    "_comment": "Indicateur de qualité des données. ok=false N'EMPÊCHE PAS le lancement de l'implantation — déclenche warnings UI + demande saisie manuelle.",

    "ok": {
      "_comment": "true si TOUS les champs ESSENTIELS sont exploitables (value ≠ null ET source ∈ {AI, MANUAL, DERIVED}). INDICATEUR, jamais verrou.",
      "type": "boolean"
    },

    "missing": {
      "_comment": "Liste des chemins de champs ESSENTIELS non exploitables (value=null OU source='UNKNOWN').",
      "type": "array of string",
      "example": [
        "implantationVoirie.alignement.mode",
        "empriseAuSol.ces"
      ]
    },

    "warnings": {
      "_comment": "Liste des chemins de champs NON ESSENTIELS manquants (informatif).",
      "type": "array of string",
      "example": [
        "hauteur.hauteurMaximale",
        "stationnement.vehicules.ratioLogement"
      ]
    },

    "derivedFieldsUsed": {
      "_comment": "Liste des chemins de champs dont source='DERIVED'.",
      "type": "array of string",
      "example": [
        "implantationFondParcelle.implantationEnLimite.mode",
        "implantationFondParcelle.reculMinimal"
      ]
    },

    "manualOverrides": {
      "_comment": "Liste des chemins de champs dont source='MANUAL' (saisie utilisateur).",
      "type": "array of string",
      "example": [
        "empriseAuSol.ces"
      ]
    }
  }
}
```

---

## B) Section finale : Classification des champs et règles

### CHAMPS ESSENTIELS (warnings UI si manquants, saisie manuelle demandée)

| # | Chemin | Condition d'exploitation |
|---|--------|-------------------------|
| 1 | `implantationVoirie.alignement.mode` | value ≠ null ET source ∈ {AI, MANUAL, DERIVED} |
| 2 | `implantationVoirie.reculMinimal` | Requis SI alignement.mode ≠ "OBLIGATOIRE" |
| 3 | `implantationLimitesSeparatives.implantationEnLimite.mode` | value ≠ null ET source ∈ {AI, MANUAL, DERIVED} |
| 4 | `implantationLimitesSeparatives.reculMinimalSiRetrait` | Requis SI mode ∈ {"AUTORISE", "INTERDIT", "INCONNU"} ET pas de formule H/x exploitable |
| 5 | `implantationFondParcelle.implantationEnLimite.mode` | value ≠ null OU identiqueLimitesSeparatives.value = true |
| 6 | `implantationFondParcelle.reculMinimal` | Requis SI mode ≠ "OBLIGATOIRE" ET identiqueLimitesSeparatives ≠ true |
| 7 | `empriseAuSol.ces` | value ≠ null ET source ∈ {AI, MANUAL, DERIVED} |

---

### CHAMPS NON ESSENTIELS (informatifs, génèrent warnings secondaires)

| Chemin | Usage |
|--------|-------|
| `implantationVoirie.reculMaximal` | Bande d'implantation |
| `hauteur.hauteurMaximale` | Volumétrie, recul H/x |
| `hauteur.modeCalcul` | Contexte de mesure |
| `hauteur.hauteurFacadeMaximale` | Gabarit façade |
| `hauteur.nombreNiveauxMaximal` | Informatif |
| `stationnement.vehicules.*` | Faisabilité programme |
| `stationnement.velos.*` | Conformité réglementaire |
| `reglesComplementaires.distanceEntreConstructions` | Multi-bâtiments |
| `reglesComplementaires.espaceLibrePleineTerre` | Contrainte environnementale |
| `reglesComplementaires.surfaceMinimaleParcelle` | Condition de constructibilité |

---

### RÈGLES DE DÉRIVATION AUTORISÉES

| Champ cible | Source | Condition de dérivation |
|-------------|--------|------------------------|
| `implantationFondParcelle.implantationEnLimite.mode` | `implantationLimitesSeparatives.implantationEnLimite.mode` | `identiqueLimitesSeparatives.value = true` |
| `implantationFondParcelle.reculMinimal` | `implantationLimitesSeparatives.reculMinimalSiRetrait` | `identiqueLimitesSeparatives.value = true` |
| `implantationLimitesSeparatives.reculMinimalSiRetrait` (calculé) | `hauteur.hauteurMaximale` × formule | `reculProportionnelHauteur.formule.value ≠ null` ET `hauteur.hauteurMaximale.value ≠ null` |

**Règle** : Tout champ dérivé doit avoir `source = "DERIVED"` et une `note` explicative.

---

### ALGORITHME DE COMPLÉTUDE
```
EXPLOITABLE(champ) = champ.value ≠ null ET champ.source ∈ {"AI", "MANUAL", "DERIVED"}

completeness.ok = TRUE si et seulement si :

  EXPLOITABLE(implantationVoirie.alignement.mode)
  
  ET (alignement.mode.value = "OBLIGATOIRE" OU EXPLOITABLE(implantationVoirie.reculMinimal))
  
  ET EXPLOITABLE(implantationLimitesSeparatives.implantationEnLimite.mode)
  
  ET (
    implantationEnLimite.mode.value = "OBLIGATOIRE"
    OU EXPLOITABLE(reculMinimalSiRetrait)
    OU (EXPLOITABLE(reculProportionnelHauteur.formule) ET EXPLOITABLE(hauteur.hauteurMaximale))
  )
  
  ET (
    EXPLOITABLE(implantationFondParcelle.implantationEnLimite.mode)
    OU identiqueLimitesSeparatives.value = true
  )
  
  ET (
    implantationFondParcelle.implantationEnLimite.mode.value = "OBLIGATOIRE"
    OU EXPLOITABLE(implantationFondParcelle.reculMinimal)
    OU identiqueLimitesSeparatives.value = true
  )
  
  ET EXPLOITABLE(empriseAuSol.ces)