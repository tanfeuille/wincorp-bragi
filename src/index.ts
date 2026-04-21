// @spec specs/models-config.spec.md v1.1 §3.1
//
// Surface publique de `@tanfeuille/bragi`.
// Re-exports uniquement — toute la logique vit dans les modules dédiés.

// Fonctions publiques
export {
  getModelId,
  getPricing,
  getModelConfig,
  listActiveModels,
  getDisplayName,
  isCanonicalModelName,
} from "./api.js";

// Erreurs
export {
  BragiError,
  ModelNotFoundError,
  ModelDisabledError,
  InvalidConfigError,
} from "./errors.js";

// Types
export type {
  ModelPricing,
  ModelCapabilities,
  ModelConfig,
  CircuitBreakerParams,
  RetryParams,
  BragiBuildMetadata,
  UsageEvent,
} from "./types.js";

// Types + constantes générés
export type { CanonicalModelName, CanonicalModelId } from "./models.generated.js";
export {
  CANONICAL_MODEL_NAMES,
  CANONICAL_MODEL_IDS,
  BRAGI_VERSION,
  BRAGI_URD_HASH,
  BRAGI_URD_DATE,
  BRAGI_CONFIG_VERSION,
  BRAGI_BUILD_METADATA,
} from "./models.generated.js";
