// @generated — DO NOT EDIT MANUALLY
// @spec specs/models-config.spec.md v1.1
// generated_with: js-yaml@4.1.0, bragi@0.1.2, node@24.14.0
// from urd hash 23541b03ba4923fdda13de66075d5249fce36d48d7a85e6e17caee7afa0bb03e, at 2026-04-22T08:12:18.094Z
//
// Pour régénérer : npm run sync-models depuis wincorp-bragi/
// Édition manuelle interdite — le self-check runtime (R-SELFCHECK) détecte
// toute divergence de hash au premier lookup et throw InvalidConfigError.

export const CANONICAL_MODEL_NAMES = [
  "claude-sonnet",
  "claude-opus",
  "claude-haiku",
] as const;

export type CanonicalModelName = (typeof CANONICAL_MODEL_NAMES)[number];

export const CANONICAL_MODEL_IDS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-haiku-4-5-20251001",
] as const;

export type CanonicalModelId = (typeof CANONICAL_MODEL_IDS)[number];

export const MODELS_CONFIG = [
  {
    "name": "claude-sonnet",
    "display_name": "Claude Sonnet 4.6",
    "id": "claude-sonnet-4-6",
    "max_tokens": 8192,
    "timeout_sec": 120,
    "capabilities": {
      "supports_thinking": true,
      "supports_vision": true,
      "supports_reasoning_effort": false,
    },
    "pricing": {
      "input_per_million_eur": 2.76,
      "output_per_million_eur": 13.8,
    },
    "circuit_breaker": {
      "failure_threshold": 5,
      "recovery_timeout_sec": 60,
    },
    "retry": {
      "base_delay_sec": 1,
      "cap_delay_sec": 30,
      "max_attempts": 3,
    },
    "disabled": false,
  },
  {
    "name": "claude-opus",
    "display_name": "Claude Opus 4.7 (1M context)",
    "id": "claude-opus-4-7",
    "max_tokens": 16384,
    "timeout_sec": 1200,
    "capabilities": {
      "supports_thinking": true,
      "supports_vision": true,
      "supports_reasoning_effort": true,
    },
    "pricing": {
      "input_per_million_eur": 13.8,
      "output_per_million_eur": 69,
    },
    "circuit_breaker": {
      "failure_threshold": 3,
      "recovery_timeout_sec": 120,
    },
    "retry": {
      "base_delay_sec": 2,
      "cap_delay_sec": 60,
      "max_attempts": 3,
    },
    "disabled": false,
  },
  {
    "name": "claude-haiku",
    "display_name": "Claude Haiku 4.5",
    "id": "claude-haiku-4-5-20251001",
    "max_tokens": 4096,
    "timeout_sec": 60,
    "capabilities": {
      "supports_thinking": false,
      "supports_vision": true,
      "supports_reasoning_effort": false,
    },
    "pricing": {
      "input_per_million_eur": 0.92,
      "output_per_million_eur": 4.6,
    },
    "circuit_breaker": {
      "failure_threshold": 10,
      "recovery_timeout_sec": 30,
    },
    "retry": {
      "base_delay_sec": 0.5,
      "cap_delay_sec": 10,
      "max_attempts": 5,
    },
    "disabled": false,
  },
] as const;

export const MODELS_CONFIG_HASH = "3919b91765a26a002ffe29f3821bb0ead0539159d0ca52b314f6a88f42a64edd" as const;

export const BRAGI_VERSION = "0.1.2" as const;
export const BRAGI_URD_HASH = "23541b03ba4923fdda13de66075d5249fce36d48d7a85e6e17caee7afa0bb03e" as const;
export const BRAGI_URD_DATE = "2026-04-22" as const;
export const BRAGI_CONFIG_VERSION = 1 as const;

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

export const BRAGI_BUILD_METADATA: BragiBuildMetadata = {
  bragi_version: BRAGI_VERSION,
  urd_hash: BRAGI_URD_HASH,
  urd_updated_date: BRAGI_URD_DATE,
  config_version: BRAGI_CONFIG_VERSION,
  generated_with: {
    js_yaml: "4.1.0",
    node: "24.14.0",
    typescript: "5.7.x",
  },
  generated_at: "2026-04-22T08:12:18.094Z",
} as const;

// Stat informatives (pas de garantie API publique — cf src/api.ts pour exports stables)
export const MODELS_ACTIVE_COUNT = 3 as const;
export const MODELS_TOTAL_COUNT = 3 as const;
