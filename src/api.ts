// @spec specs/models-config.spec.md v1.1 §3 + §4
//
// API publique bragi : 5 fonctions + guard runtime.
// - Load-once synchrone au premier import (R2) : Map + ReadonlySet + sorted array.
// - Self-check hash au premier lookup public (R-SELFCHECK) : détecte tampering
//   post-publish sur models.generated.ts.
// - Lookups O(1) via structures pré-calculées.
// - Zero I/O runtime — tout est embarqué dans le bundle dist (R11, R11a, R11b).

import { createHash } from "node:crypto";
import {
  CANONICAL_MODEL_NAMES,
  MODELS_CONFIG,
  MODELS_CONFIG_HASH,
  BRAGI_VERSION,
} from "./models.generated.js";
import type { CanonicalModelName, CanonicalModelId } from "./models.generated.js";
import type { ModelConfig, ModelPricing } from "./types.js";
import {
  ModelNotFoundError,
  ModelDisabledError,
  InvalidConfigError,
} from "./errors.js";

// =============================================================================
// Structures pré-calculées au load (R2)
// =============================================================================

/**
 * Type interne qui accepte disabled boolean (MODELS_CONFIG contient tous les
 * modèles, actifs et disabled). Les fonctions publiques filtrent et throw.
 */
interface _AnyModelConfig {
  readonly name: CanonicalModelName;
  readonly display_name: string;
  readonly id: CanonicalModelId;
  readonly max_tokens: number;
  readonly timeout_sec: number;
  readonly capabilities: ModelConfig["capabilities"];
  readonly pricing: ModelConfig["pricing"];
  readonly circuit_breaker: ModelConfig["circuit_breaker"];
  readonly retry: ModelConfig["retry"];
  readonly disabled: boolean;
}

/** Cast explicite : MODELS_CONFIG est un tuple as const, chaque item a disabled true/false. */
const ALL_MODELS: readonly _AnyModelConfig[] = MODELS_CONFIG as unknown as readonly _AnyModelConfig[];

/** Map O(1) pour lookups par nom canonique. Inclut les modèles disabled (filter côté API). */
const MODELS_MAP: ReadonlyMap<CanonicalModelName, _AnyModelConfig> = (() => {
  const m = new Map<CanonicalModelName, _AnyModelConfig>();
  for (const cfg of ALL_MODELS) {
    m.set(cfg.name, cfg);
  }
  return m;
})();

/** Set O(1) pour isCanonicalModelName guard. */
const CANONICAL_NAMES_SET: ReadonlySet<string> = new Set<string>(CANONICAL_MODEL_NAMES);

/**
 * Snapshot figé des modèles actifs, trié par display_name.
 * Référence partagée immutable — pas de re-sort à chaque appel listActiveModels() (R2).
 */
const ACTIVE_MODELS: readonly ModelConfig[] = Object.freeze(
  ALL_MODELS
    .filter((m): m is _AnyModelConfig & { disabled: false } => !m.disabled)
    .slice()
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "fr")) as unknown as readonly ModelConfig[],
);

// =============================================================================
// Self-check runtime (R-SELFCHECK)
// =============================================================================

let _selfCheckDone = false;

/**
 * Valide au premier lookup public que le hash embarqué correspond au contenu
 * actuel de MODELS_CONFIG. Détecte édition manuelle / corruption post-publish.
 * Désactivable via env `BRAGI_SKIP_SELFCHECK=1` (tests).
 */
function runSelfCheckOnce(): void {
  if (_selfCheckDone) return;
  if (process.env["BRAGI_SKIP_SELFCHECK"] === "1") {
    _selfCheckDone = true;
    return;
  }
  const actual = createHash("sha256").update(JSON.stringify(ALL_MODELS)).digest("hex");
  if (actual !== MODELS_CONFIG_HASH) {
    throw new InvalidConfigError(
      "Hash SHA-256 divergent — models.generated.ts modifié après build",
      MODELS_CONFIG_HASH,
      actual,
    );
  }
  _selfCheckDone = true;
}

/** Exposé pour tests : reset le cache de self-check. */
export function _resetSelfCheckForTests(): void {
  _selfCheckDone = false;
}

// =============================================================================
// Guard runtime (R4)
// =============================================================================

/**
 * Valide qu'une valeur inconnue est un CanonicalModelName actuel.
 * Typeguard strict : type + longueur + regex + whitelist.
 * Usage typique : validation d'input utilisateur côté backend (req.body,
 * JSON.parse, form data) avant appel getModelId / getModelConfig.
 */
export function isCanonicalModelName(v: unknown): v is CanonicalModelName {
  if (typeof v !== "string") return false;
  if (v.length < 1 || v.length > 32) return false;
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(v)) return false;
  return CANONICAL_NAMES_SET.has(v);
}

// =============================================================================
// Lookups publics (R3, R6)
// =============================================================================

/**
 * Lookup interne qui résout un nom vers sa config ou throw ModelNotFoundError /
 * ModelDisabledError. Self-check runtime exécuté au premier appel.
 */
function lookupActive(canonicalName: CanonicalModelName): ModelConfig {
  runSelfCheckOnce();
  const cfg = MODELS_MAP.get(canonicalName);
  if (!cfg) {
    throw new ModelNotFoundError(canonicalName, [...CANONICAL_MODEL_NAMES]);
  }
  if (cfg.disabled) {
    throw new ModelDisabledError(canonicalName, BRAGI_VERSION);
  }
  return cfg as ModelConfig;
}

/**
 * Retourne le model ID provider (ex "claude-sonnet-4-6") pour un nom canonique.
 * Type retour = union littérale stricte, compatible SDK Anthropic sans cast.
 *
 * @throws ModelNotFoundError si le nom canonique n'existe pas.
 * @throws ModelDisabledError si le modèle existe mais disabled: true.
 */
export function getModelId(canonicalName: CanonicalModelName): CanonicalModelId {
  return lookupActive(canonicalName).id;
}

/**
 * Retourne le pricing EUR par million de tokens pour un modèle actif.
 */
export function getPricing(canonicalName: CanonicalModelName): ModelPricing {
  return lookupActive(canonicalName).pricing;
}

/**
 * Retourne la config complète d'un modèle actif.
 * Ne contient jamais de champ secret (enforced sync-models R7).
 */
export function getModelConfig(canonicalName: CanonicalModelName): ModelConfig {
  return lookupActive(canonicalName);
}

/**
 * Retourne la liste des modèles actifs (disabled filtrés), triés par display_name.
 * Référence partagée immutable — pas de re-sort à chaque appel (R2).
 */
export function listActiveModels(): readonly ModelConfig[] {
  runSelfCheckOnce();
  return ACTIVE_MODELS;
}

/**
 * Retourne le display_name humain (ex "Claude Sonnet 4.6") pour un modèle actif.
 * Évite que chaque consumer réimplémente un switch exhaustif qui casse à
 * l'ajout d'un modèle v2.
 */
export function getDisplayName(canonicalName: CanonicalModelName): string {
  return lookupActive(canonicalName).display_name;
}
