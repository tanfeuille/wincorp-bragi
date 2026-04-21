// @spec specs/models-config.spec.md v1.1 §3.3
//
// Types publics bragi (hors types générés qui vivent dans models.generated.ts).
// Les types `CanonicalModelName`, `CanonicalModelId` ne sont PAS ici — dérivés
// du tuple runtime `CANONICAL_MODEL_NAMES` / `CANONICAL_MODEL_IDS` généré
// depuis wincorp-urd/referentiels/models.yaml (A1 urd autoritaire, R1a).

import type { CanonicalModelName, CanonicalModelId } from "./models.generated.js";

/**
 * Pricing EUR par million de tokens.
 * Invariant (enforced par sync-models R5) : 0.1 <= x <= 200.
 */
export interface ModelPricing {
  readonly input_per_million_eur: number;
  readonly output_per_million_eur: number;
}

/**
 * Capabilities modèle (composition, pas héritage — cohérent avec pricing/retry).
 */
export interface ModelCapabilities {
  readonly supports_thinking: boolean;
  readonly supports_vision: boolean;
  readonly supports_reasoning_effort: boolean;
}

/**
 * Paramètres circuit breaker (côté odin Python ou consumer TS responsable).
 * Bragi expose la config mais n'implémente pas le circuit breaker (OUT §2).
 */
export interface CircuitBreakerParams {
  readonly failure_threshold: number;
  readonly recovery_timeout_sec: number;
}

/**
 * Paramètres retry exponentiel.
 * Bragi expose la config ; hermod (ou odin) implémente le retry (OUT §2).
 */
export interface RetryParams {
  readonly base_delay_sec: number;
  readonly cap_delay_sec: number;
  readonly max_attempts: number;
}

/**
 * Configuration d'un modèle actif.
 *
 * Invariant : `disabled: false` littéral. Les lookups directs (`getModelConfig`,
 * `listActiveModels`) ne retournent jamais de modèle `disabled: true` — un
 * `ModelDisabledError` est levé à la place (R6).
 *
 * Composition stricte : les groupes de champs (capabilities, pricing,
 * circuit_breaker, retry) sont imbriqués, pas aplanis, pour cohérence
 * sémantique et facilité de sérialisation.
 */
export interface ModelConfig {
  readonly name: CanonicalModelName;
  readonly display_name: string;
  readonly id: CanonicalModelId;
  readonly max_tokens: number;
  readonly timeout_sec: number;
  readonly capabilities: ModelCapabilities;
  readonly pricing: ModelPricing;
  readonly circuit_breaker: CircuitBreakerParams | null;
  readonly retry: RetryParams | null;
  /**
   * Discriminant type — toujours `false` dans un objet retourné par les
   * fonctions publiques bragi. Les modèles disabled lèvent ModelDisabledError.
   * Ce champ n'est PAS un flag métier d'activité ; utiliser listActiveModels()
   * pour la logique runtime.
   */
  readonly disabled: false;
}

/**
 * Metadata de build embarquée dans le package, exposée pour traçabilité.
 * Permet aux consumers (thor, bifrost) de logger au boot la version de bragi
 * et le hash du YAML source utilisé (R22).
 */
export interface BragiBuildMetadata {
  readonly bragi_version: string;
  readonly urd_hash: string;
  readonly urd_updated_date: string;
  readonly config_version: 1;
  readonly generated_with: {
    readonly js_yaml: string;
    readonly node: string;
    readonly typescript: string;
  };
  readonly generated_at: string;
}

/**
 * Event de tracking usage — type partagé avec hermod pour cohérence
 * inter-package (hermod émet ce type via onUsage callback).
 * Bragi ne l'émet jamais lui-même (pas de wrap SDK — OUT §2), mais expose le
 * type pour que les consumers puissent le déclarer dans leurs signatures.
 *
 * `call_id` est optionnel côté bragi (un consumer qui construit manuellement
 * peut l'omettre). Hermod le fournit toujours via randomUUID pour corréler
 * avec FailedAttemptEvent.
 */
export interface UsageEvent {
  readonly call_id?: string;
  readonly canonical_name: CanonicalModelName;
  readonly canonical_id: CanonicalModelId;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cost_eur: number;
  readonly duration_ms: number;
  readonly timestamp_iso: string;
}
