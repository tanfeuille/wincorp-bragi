// @spec specs/models-config.spec.md v1.1 §3.4 + R9 + R9a
//
// Hiérarchie d'erreurs bragi.
// - `BragiError` abstraite base + `code` littéral pour narrowing cross-realm.
// - Chaque subclass utilise `Object.setPrototypeOf` (ES5 downleveling safe).
// - Messages FR (R9), sanitize anti log-injection (R9a, §sanitizeValue).

import type { CanonicalModelName } from "./models.generated.js";

/**
 * Classe abstraite de base pour toutes les erreurs bragi.
 * Le champ `code` littéral permet un narrowing cross-realm (pattern :
 * `if (e.code === "BRAGI_...") {...}`) quand `instanceof` échoue (multiples
 * versions de bragi via deps transitives, cf. EC26).
 */
export abstract class BragiError extends Error {
  abstract readonly code:
    | "BRAGI_MODEL_NOT_FOUND"
    | "BRAGI_MODEL_DISABLED"
    | "BRAGI_INVALID_CONFIG";

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Nom canonique demandé inexistant dans la whitelist bragi.
 * Typiquement : consumer qui caste un input non validé (`as any`).
 * Le champ `available` liste les noms valides pour debugging.
 */
export class ModelNotFoundError extends BragiError {
  readonly code = "BRAGI_MODEL_NOT_FOUND" as const;

  constructor(
    readonly canonicalName: string,
    readonly available: readonly CanonicalModelName[],
  ) {
    super(
      `Modèle canonique inconnu : ${sanitizeValue(canonicalName)}. ` +
        `Modèles disponibles : ${available.join(", ")}. ` +
        `Valider via isCanonicalModelName() en amont.`,
    );
    Object.setPrototypeOf(this, ModelNotFoundError.prototype);
  }
}

/**
 * Modèle existe dans la config mais `disabled: true`.
 * Lookups directs (getModelId/getPricing/getModelConfig) lèvent cette erreur
 * au lieu de filter silencieusement. Utiliser `listActiveModels()` pour filtrer.
 */
export class ModelDisabledError extends BragiError {
  readonly code = "BRAGI_MODEL_DISABLED" as const;

  constructor(
    readonly canonicalName: CanonicalModelName,
    readonly bragiVersion: string,
  ) {
    super(
      `Modèle '${canonicalName}' est désactivé (disabled: true) dans bragi@${bragiVersion}. ` +
        `Utiliser listActiveModels() pour la liste filtrée ou attendre une prochaine version.`,
    );
    Object.setPrototypeOf(this, ModelDisabledError.prototype);
  }
}

/**
 * `models.generated.ts` corrompu ou modifié post-sync.
 * Détecté par self-check SHA-256 au premier lookup (R-SELFCHECK).
 * Indique tampering ou bug build : réinstaller le package.
 */
export class InvalidConfigError extends BragiError {
  readonly code = "BRAGI_INVALID_CONFIG" as const;

  constructor(
    readonly reason: string,
    readonly expectedHash?: string,
    readonly actualHash?: string,
  ) {
    const hashInfo =
      expectedHash && actualHash
        ? ` (hash attendu ${expectedHash.slice(0, 8)}…, calculé ${actualHash.slice(0, 8)}…)`
        : "";
    super(
      `Configuration bragi invalide : ${reason}${hashInfo}. ` +
        `Le fichier models.generated.ts a été modifié manuellement ou corrompu. ` +
        `Réinstaller le package @tanfeuille/bragi.`,
    );
    Object.setPrototypeOf(this, InvalidConfigError.prototype);
  }
}

/**
 * Sanitize une valeur brute utilisateur pour inclusion dans un message d'erreur (R9a).
 * Tronque à 64 chars + JSON.stringify pour échapper control chars/null bytes/unicode.
 * Empêche log-injection par un input malicieux.
 */
function sanitizeValue(v: unknown): string {
  let s: string;
  try {
    s = typeof v === "string" ? v : String(v);
  } catch {
    // String() peut throw sur Symbol sans description
    return "<unstringifiable>";
  }
  const truncated = s.length > 64 ? s.slice(0, 64) + "…" : s;
  return JSON.stringify(truncated);
}
