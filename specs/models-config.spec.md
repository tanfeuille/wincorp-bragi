# `wincorp_bragi.models-config` — Specification

> **Statut :** IMPLEMENTED (v0.1.2 publié GitHub Packages 22/04/2026, consommé par thor + bifrost, audit 3 agents downstream validé)
> **Version :** 1.1
> **Niveau :** 2 (standard)
> **Auteur :** Tan Phi HUYNH
> **Date de création :** 2026-04-21
> **Dernière révision :** 2026-04-21 (post-audit adversarial 3 agents)
> **@plan** `memory/project_deerflow_inspiration_plan.md` Phase 10.1 (extension TS miroir `wincorp-odin`, séparée en bragi+hermod après audit)
> **Nom logique** : `@tanfeuille/bragi` (package npm, registry privé `npm.pkg.github.com`)
> **Package TS réel** : `wincorp-bragi` (Yggdrasil Tronc — Bragi, dieu de la poésie et de l'énumération mémorisée)
> **Spec jumelle Python** : `wincorp-odin/specs/llm-factory.spec.md v1.3.4` (même source YAML, API différente)
> **Spec complémentaire TS** : `wincorp-hermod/specs/hermod-client.spec.md` (wrapper SDK Anthropic, dépend de bragi)
> **Source YAML canonique** : `wincorp-urd/referentiels/models.yaml` (compilé en TS au build via `sync-models`)

---

## 1. Objectif

Exposer aux consommateurs TypeScript (`@tanfeuille/hermod` en premier lieu, puis `wincorp-thor` + `wincorp-bifrost`) un accès **typé et statique** à la configuration des modèles LLM définie dans `wincorp-urd/referentiels/models.yaml` — sans dépendre du SDK Anthropic ni de logique runtime.

Bragi = **données pures**. Hermod = **actions** (wrapper SDK). Cette séparation verrouille architecturalement la contamination du SDK côté configuration.

Objectif opérationnel : une seule source de vérité YAML (`urd`), deux consommations (Python via `odin`, TS via `bragi`+`hermod`), zéro dérive silencieuse sur les model IDs, pricing ou capabilities. Détection automatique des drifts via CI gate (`check-sync`) et GitHub Action auto-sync (ouverture PR automatique).

---

## 2. Périmètre

### IN — Ce que le module fait (v1.0)

- Exposer la config LLM via **un fichier TypeScript compilé** (`src/models.generated.ts`) généré au build depuis le YAML canonique d'urd. **Zéro parsing YAML au runtime**.
- Valider l'intégrité de la config via self-check SHA-256 au premier import (R-SELFCHECK).
- Exposer **5 fonctions publiques** : `getModelId`, `getPricing`, `getModelConfig`, `listActiveModels`, `getDisplayName`.
- Exposer un **type guard runtime** `isCanonicalModelName()` pour validation UI → backend.
- Exposer les **types TypeScript** dérivés : `CanonicalModelName`, `CanonicalModelId`, `ModelPricing`, `ModelConfig`, `ModelCapabilities`, `CircuitBreakerParams`, `RetryParams`.
- Exposer les **erreurs typées** : `BragiError` (abstraite base), `ModelNotFoundError`, `ModelDisabledError`, `InvalidConfigError` avec `code` littéral pour narrowing cross-realm.
- Exposer les **constantes de traçabilité** : `BRAGI_VERSION`, `BRAGI_URD_HASH`, `BRAGI_URD_DATE`, `BRAGI_CONFIG_VERSION`, `BRAGI_BUILD_METADATA`.
- Fournir le script `sync-models` qui lit `wincorp-urd/referentiels/models.yaml`, valide strictement (règles miroir `odin`), strippe les champs sensibles, et génère `src/models.generated.ts` (TS compilable).
- Fournir le script `check-sync` qui vérifie au build que `src/models.generated.ts` est aligné sur `wincorp-urd/referentiels/models.yaml` (hash SHA-256).
- Fournir la **GitHub Action `auto-sync-from-urd.yml`** (côté urd) qui ouvre un DRAFT PR automatique sur bragi à chaque push urd modifiant `models.yaml`.
- Publier sur GitHub Packages `https://npm.pkg.github.com` sous `@tanfeuille/bragi` (CI tag `v*` + gate `check-sync` + gate test).
- Distribution ESM NodeNext uniquement, types `.d.ts` générés, compatibilité Node >= 20.

### OUT — Ce que le module ne fait PAS (v1.0, verrous architecturaux)

- **PAS de wrapping du SDK Anthropic**. Rôle dévolu à `@tanfeuille/hermod` (repo `wincorp-hermod`). Bragi ne fait jamais d'appel LLM, ne manipule jamais de clé API, n'ouvre jamais de connexion réseau.
- **PAS de circuit breaker runtime**. Reste côté `wincorp-odin` Python uniquement. Côté TS, responsabilité d'`@tanfeuille/hermod` si simple, ou d'une future v2 si distribué.
- **PAS de retry exponentiel runtime**. Idem hermod/odin.
- **PAS de tracking tokens / middleware usage**. Idem hermod/odin.
- **PAS de dépendance à `@anthropic-ai/sdk`** dans `dependencies` ni `peerDependencies` ni `devDependencies` (verrou archi — R11, testé).
- **PAS de dépendance à `js-yaml` au runtime**. La lib est utilisée uniquement dans `scripts/sync-models.mjs` (devDependency épinglée, testée), jamais dans le code distribué (`dist/`).
- **PAS de dépendance à `fetch`, `axios`, `node-fetch`, `@supabase/supabase-js`** — aucun besoin réseau runtime.
- **PAS de hot reload**. La config est figée à la version publiée du package.
- **PAS de fetch HTTP / filesystem externe au runtime**. Toute la config est statiquement embarquée dans `dist/models.generated.js`.
- **PAS d'interpolation `${ENV_VAR}`**. Les champs `api_key` du YAML et tout champ matchant `/(?:_key|_token|_secret|_password)$/i` sont **ignorés et non propagés** au TS généré (R7).
- **PAS de filtrage silencieux des modèles `disabled: true`** sur lookups directs. Demande explicite d'un modèle disabled = erreur dédiée (R6). Exception : `listActiveModels()` filtre naturellement.
- **PAS de validation réseau** (pas de ping aux endpoints Anthropic au load).
- **PAS de providers non-Anthropic en v1.0** (structure prête, activation post-v1 si besoin).
- **PAS de protection contre mutation via `structuredClone` / `JSON roundtrip`** (cf. R8b). Les consommateurs qui clonent assument la responsabilité.
- **PAS de support CommonJS**. ESM-only (`"type": "module"`). Test boot CJS explicite qui vérifie l'erreur claire actionnable (aligné `feedback_tsx_esm_cjs_boot_crash.md`).
- **PAS de merge automatique côté GA auto-sync**. Le workflow ouvre un DRAFT PR seulement, révision humaine obligatoire (protège contre supply chain, R-NEW-14).
- **PAS de suivi `pricing_valid_until` ni `deprecated_at` en v1.0**. Reporté v1.2 (cf. Questions ouvertes Q2/Q3).

---

## 3. Interface

### 3.1 Exports publics (`src/index.ts`)

```ts
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
  CanonicalModelName,
  CanonicalModelId,
  ModelPricing,
  ModelCapabilities,
  ModelConfig,
  CircuitBreakerParams,
  RetryParams,
  BragiBuildMetadata,
  UsageEvent,
} from "./types.js";

// Constantes de traçabilité (injectées au build par sync-models)
export {
  CANONICAL_MODEL_NAMES,
  BRAGI_VERSION,
  BRAGI_URD_HASH,
  BRAGI_URD_DATE,
  BRAGI_CONFIG_VERSION,
  BRAGI_BUILD_METADATA,
} from "./models.generated.js";
```

### 3.2 Signatures

```ts
/**
 * Retourne le `model` ID provider (ex "claude-sonnet-4-6") pour un nom canonique.
 * Type retour = union littérale stricte, compatible SDK Anthropic sans cast.
 *
 * @throws ModelNotFoundError si le nom canonique n'existe pas (cast as any, non-string, etc.)
 * @throws ModelDisabledError si le modèle existe mais disabled: true dans la config
 */
export function getModelId(canonicalName: CanonicalModelName): CanonicalModelId;

/** Retourne le pricing EUR par million de tokens. */
export function getPricing(canonicalName: CanonicalModelName): ModelPricing;

/** Retourne la config complète typée. Ne contient jamais de champ secret (R7). */
export function getModelConfig(canonicalName: CanonicalModelName): ModelConfig;

/**
 * Retourne la liste des modèles actifs (non-disabled), triés par display_name.
 * Snapshot figé construit au load du module, référence partagée immutable (R8).
 * Retourne [] si tous les modèles sont disabled (responsabilité consommateur de gérer).
 */
export function listActiveModels(): readonly ModelConfig[];

/**
 * Retourne le display_name humain (ex "Claude Sonnet 4.6").
 * Évite que chaque consommateur re-implémente un switch exhaustif qui casse à l'ajout d'un modèle v2.
 */
export function getDisplayName(canonicalName: CanonicalModelName): string;

/**
 * Type guard runtime pour valider une string inconnue (req.body, form input, JSON.parse).
 * Utilisation : bifrost UI → backend, validation input utilisateur.
 */
export function isCanonicalModelName(v: unknown): v is CanonicalModelName;
```

### 3.3 Types exportés

```ts
// === src/models.generated.ts (généré par sync-models) ===

/**
 * Tuple runtime des noms canoniques actifs dans cette version du package.
 * Source unique de vérité : dérivé de wincorp-urd/referentiels/models.yaml.
 * Exporté en `as const` — l'union littérale CanonicalModelName dérive.
 */
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

export const BRAGI_VERSION = "0.1.0" as const;
export const BRAGI_URD_HASH = "<sha256-du-yaml>" as const;
export const BRAGI_URD_DATE = "2026-04-21" as const;
export const BRAGI_CONFIG_VERSION = 1 as const;

export const BRAGI_BUILD_METADATA: BragiBuildMetadata = {
  bragi_version: BRAGI_VERSION,
  urd_hash: BRAGI_URD_HASH,
  urd_updated_date: BRAGI_URD_DATE,
  config_version: BRAGI_CONFIG_VERSION,
  generated_with: { js_yaml: "4.1.0", node: "20.x", typescript: "5.7.x" },
  generated_at: "2026-04-21T19:50:00Z",
} as const;

// === src/types.ts ===

export interface ModelPricing {
  /** @invariant > 0, enforced by sync-models (R5) */
  readonly input_per_million_eur: number;
  readonly output_per_million_eur: number;
}

export interface ModelCapabilities {
  readonly supports_thinking: boolean;
  readonly supports_vision: boolean;
  readonly supports_reasoning_effort: boolean;
}

export interface CircuitBreakerParams {
  readonly failure_threshold: number;
  readonly recovery_timeout_sec: number;
}

export interface RetryParams {
  readonly base_delay_sec: number;
  readonly cap_delay_sec: number;
  readonly max_attempts: number;
}

export interface ModelConfig {
  readonly name: CanonicalModelName;
  readonly display_name: string;
  readonly id: CanonicalModelId;
  readonly max_tokens: number;
  readonly timeout_sec: number;
  /** Composition (pas héritage) — cohérent avec pricing, circuit_breaker, retry */
  readonly capabilities: ModelCapabilities;
  readonly pricing: ModelPricing;
  readonly circuit_breaker: CircuitBreakerParams | null;
  readonly retry: RetryParams | null;
  /**
   * Discriminant type, jamais `true` dans un objet retourné par getModelConfig/listActiveModels.
   * Les modèles disabled sont indexés en interne mais les lookups directs lèvent ModelDisabledError.
   * N'est PAS un flag métier d'activité — utiliser listActiveModels() pour la logique runtime.
   */
  readonly disabled: false;
}

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

/** Event opt-in pour hermod tracking métriques (shared type). */
export interface UsageEvent {
  readonly canonical_name: CanonicalModelName;
  readonly canonical_id: CanonicalModelId;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cost_eur: number;
  readonly duration_ms: number;
  readonly timestamp_iso: string;
}
```

### 3.4 Erreurs

Classe de base abstraite `BragiError` + 3 classes concrètes avec `code` littéral pour narrowing cross-realm.

```ts
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

export class ModelNotFoundError extends BragiError {
  readonly code = "BRAGI_MODEL_NOT_FOUND" as const;
  constructor(
    readonly canonicalName: string,
    readonly available: readonly CanonicalModelName[],
  ) { /* ... */ }
}

export class ModelDisabledError extends BragiError {
  readonly code = "BRAGI_MODEL_DISABLED" as const;
  constructor(
    readonly canonicalName: CanonicalModelName,
    readonly bragiVersion: string,
  ) { /* ... */ }
}

export class InvalidConfigError extends BragiError {
  readonly code = "BRAGI_INVALID_CONFIG" as const;
  constructor(
    readonly reason: string,
    readonly expectedHash?: string,
    readonly actualHash?: string,
  ) { /* ... */ }
}
```

| Code | Condition | Action consommateur |
|------|-----------|---------------------|
| `BRAGI_MODEL_NOT_FOUND` | Nom canonique inexistant (cast as any, input non validé) | Vérifier via `isCanonicalModelName()` en amont |
| `BRAGI_MODEL_DISABLED` | Modèle existe dans config mais `disabled: true` | `listActiveModels()` ou catch + fallback |
| `BRAGI_INVALID_CONFIG` | `models.generated.ts` corrompu (détecté par self-check SHA-256) | Erreur système : réinstaller le package |

---

## 4. Règles métier

### 4.1 Source et distribution

- **R1: Source unique YAML, compilée en TS au build**. Source canonique = `wincorp-urd/referentiels/models.yaml`. Le script `npm run sync-models` lit ce YAML, valide strictement, et génère `wincorp-bragi/src/models.generated.ts` (constante `MODELS_CONFIG`, union `CanonicalModelName`, constantes `BRAGI_*`). **Le runtime bragi n'ouvre JAMAIS un fichier YAML.**

- **R1a: Urd est autoritaire (A1)**. L'ajout d'un modèle côté urd ne requiert PAS d'édition manuelle du type TS — `CanonicalModelName` et `CanonicalModelId` sont **dérivés du tuple runtime `CANONICAL_MODEL_NAMES`** généré depuis le YAML. La GA `auto-sync-from-urd.yml` (R17) ouvre un DRAFT PR automatique dès qu'urd push un changement models.yaml. Gate humain = review+merge du DRAFT PR.

- **R2: Load-once synchrone, structures pré-calculées O(1)**. Au premier import (évaluation ESM) :
  1. `Map<CanonicalModelName, ModelConfig>` pour lookups O(1).
  2. `readonly ModelConfig[]` des actifs triés par `display_name` pour `listActiveModels()` — référence partagée, pas de re-sort à chaque appel.
  3. `ReadonlySet<CanonicalModelName>` pour `isCanonicalModelName()` O(1).
  Top-level `Object.freeze()` (pas récursif — `as const` TS garantit déjà l'immuabilité structurelle).

- **R3: Clé canonique = champ `name`**. Lookup exclusif sur `name` (ex `claude-sonnet`), jamais sur `model` (ex `claude-sonnet-4-6`).

- **R4: Whitelist stricte via tuple + type guard runtime**. `CANONICAL_MODEL_NAMES` est un `as const` tuple exposé. `isCanonicalModelName()` valide :
  ```ts
  typeof v === "string"
    && v.length >= 1 && v.length <= 32
    && /^[a-z][a-z0-9-]{0,31}$/.test(v)
    && (CANONICAL_MODEL_NAMES as readonly string[]).includes(v);
  ```

### 4.2 Validation YAML (miroir odin)

Règles enforcées par `sync-models.mjs` au moment de la génération.

- **R5: Pricing obligatoire, plage raisonnable**. Chaque modèle non-disabled doit avoir `pricing.input_per_million_eur` et `pricing.output_per_million_eur` en `number` tel que `0.1 <= x <= 200` EUR/M. Hors plage → sync-models refuse. Override via `--accept-pricing-change` avec justification commit.

- **R6: `disabled: true` ne filtre jamais silencieusement sur lookups directs**. Indexé en interne mais lookups directs lèvent `ModelDisabledError`. Exception : `listActiveModels()` filtre naturellement.

- **R7: Stripping strict des champs secrets au sync-models**.
  1. Nom de clé matchant `/^(api_key|api_token|_token|secret|password|auth_header|authorization)$/i` → ignoré, non propagé.
  2. Valeur littérale matchant `/^(sk-ant-|sk-|Bearer |AKIA|ghp_|github_pat_)/` → sync-models **échoue** avec message "Secret littéral détecté".
  Fixture test avec `sk-ant-test-FAKE` vérifie le fail.

- **R7a: `ModelConfig` ne déclare jamais de champ secret**. Test TS unitaire vérifie via `Exclude<keyof ModelConfig, ...>` que `api_key`, `api_token`, `secret`, `password`, `auth_header`, `authorization` ne sont jamais dans le type public.

- **R7b: `sync-models` utilise js-yaml avec schema safe**. Appel explicite `yaml.load(content, { schema: yaml.CORE_SCHEMA })`. Refus tags custom. Test avec fixture `!!js/function` vérifie reject. Lint CI bloque `yaml.load(` sans second arg.

- **R7c: Refus des champs inconnus dans le YAML**. Valide clés selon schéma (miroir Pydantic `extra='forbid'` odin). Champ non reconnu → échec avec pointer. Pas de silent ignore.

- **R7d: Taille max YAML source**. `>50 KB` warning + exit 0. `>1 MB` refus avec message "Taille anormale, corruption probable". Miroir odin R15.

- **R7e: Normalisation I/O cross-OS**. `sync-models` strip BOM UTF-8 (`\uFEFF`), convertit CRLF → LF, trim trailing whitespace, **avant** hash SHA-256 ET parsing YAML. Garantit hash identique Linux/Windows/macOS (contexte OneDrive tanfeuille/tanph).

### 4.3 Immutabilité et traçabilité

- **R8: Immutabilité compile-time + top-level freeze**. `models.generated.ts` émis avec `as const` récursif. Top-level `Object.freeze()` au load. Tests :
  1. `Object.isFrozen(MODELS_CONFIG)` === true.
  2. Mutation TS strict → compile error.
  3. `(cfg as any).id = "X"` → throw TypeError en mode strict ESM.

- **R8b: Pas de protection contre clonage**. `structuredClone` et `JSON.parse(JSON.stringify(...))` produisent des copies mutables. Documenté en Section 2 OUT. Responsabilité consommateur.

- **R-SELFCHECK: Runtime hash self-check au premier lookup**. `models.generated.ts` expose `MODELS_CONFIG_HASH`. Au premier lookup public, calcul `sha256(JSON.stringify(MODELS_CONFIG))` et comparaison. Divergence → `InvalidConfigError` avec `expectedHash` + `actualHash`. Protège contre édition manuelle post-sync, corruption post-publish. Coût ~1 ms au premier lookup. Désactivable via env `BRAGI_SKIP_SELFCHECK=1` pour tests.

### 4.4 Sécurité & verrous

- **R9: Erreurs messages en français**. Stack trace reste EN.

- **R9a: Sanitization messages d'erreur**. Valeurs brutes utilisateur dans messages : tronquées à 64 chars + `JSON.stringify(v.slice(0, 64))` pour échapper control chars/unicode/null bytes. Empêche log-injection.

- **R10: Jamais de log du fichier généré complet**. Mode debug futur (hors v1.0) expose noms canoniques et capabilities seulement.

- **R11: Aucune dépendance à `@anthropic-ai/sdk`**. Nulle part. Test unitaire parse `package.json`. Un PR qui l'ajoute est un signal archi à challenger (un wrapper SDK existe déjà : `@tanfeuille/hermod`).

- **R11a: Aucune dépendance réseau runtime**. Interdits `dependencies` : `axios`, `node-fetch`, `undici`, `@supabase/supabase-js`, tout SDK cloud. Test unitaire vérifie.

- **R11b: Aucun side-effect I/O au load**. Test `test_no_runtime_side_effects.test.ts` : `import("../dist/index.js")` dans Node instrumenté (fs stubs) vérifie zéro `fs.open/fs.read/fetch/net` au load. Alternative : grep CI sur `dist/*.js` pour `require('fs')`, `require('http')`, `fetch(`, top-level await non-fonction.

- **R12: Types TS = contrat exhaustif**. `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`.

### 4.5 Build & distribution

- **R13: Script `sync-models` idempotent et explicite**. Comportement :
  1. Lit `../wincorp-urd/referentiels/models.yaml` (sibling défaut, override `--urd-path=<path>`).
  2. Normalise (R7e), valide (R5, R6, R7, R7c, R7d), strippe secrets (R7).
  3. Génère `src/models.generated.ts` avec header `// generated_with: js-yaml@4.1.0, bragi@X.Y.Z, node@N.N, from urd hash <sha>, at <iso>`.
  4. Injecte `CANONICAL_MODEL_NAMES`, `CANONICAL_MODEL_IDS`, `MODELS_CONFIG`, `MODELS_CONFIG_HASH`, constantes `BRAGI_*`.
  5. Si identique → exit 0 silencieux.
  6. Si diff → affiche diff FR + réécrit + exit 0 avec message "Généré. Bump version + tag requis."
  7. Si urd absent → exit 1 avec message actionnable.

- **R13a: Check git status urd au sync**. Avant sync, vérifie `git -C ../wincorp-urd status --porcelain` + fetch non-destructif + compare HEAD à `origin/main`. Non à jour → warning non-bloquant. Skip via `--force`.

- **R13b: Tests dédiés `scripts/sync-models.test.ts`**. Vitest couvre : cas nominal, nom hors whitelist, secret littéral, pricing manquant/hors plage, champ inconnu, doublon name, YAML tag custom, BOM stripé, CRLF normalisé, >1MB rejeté, >50KB warning. Minimum 20 tests, coverage 100%.

- **R14: Script `check-sync` gate CI pré-publish**. `npm run check-sync` (exit 0/1) vérifie que `BRAGI_URD_HASH` correspond au hash SHA-256 de `../wincorp-urd/referentiels/models.yaml` actuel (après normalisation R7e). Gate `publish.yml` : push tag `v*` sur version désynchronisée échoue.

- **R14a: `check-sync` mode "installed"**. Si `../wincorp-urd` absent, exit 0 avec warning "check-sync est un outil dev workspace, pas installed". Alternative : env var `BRAGI_URD_PATH` pour pointer explicite.

- **R15: Hook git pre-push côté urd**. Extension `block-protected-files.sh` : si commit urd touche `referentiels/models.yaml`, affiche warning non-bloquant "⚠ models.yaml modifié — GA ouvrira DRAFT PR sur bragi. Review + merge rapidement."

- **R16: Procédure bump documentée**. `README.md` section dédiée, 5 étapes : sync-models, inspect diff, bump version (patch/minor/major), commit+tag+push, consommateurs upgradent.

- **R17: GitHub Action `auto-sync-from-urd.yml`** (côté repo urd). Déclenché sur push main modifiant `referentiels/models.yaml`. Actions :
  1. Checkout urd.
  2. Checkout bragi branche `auto-sync/urd-<sha>`.
  3. Exécute `npm run sync-models` dans bragi.
  4. Bump auto version patch dans `package.json`.
  5. Commit "chore(auto-sync): urd @<sha-urd-court>".
  6. Push branche + ouvre **DRAFT PR** sur bragi main avec template détaillé.
  Reviewer humain obligatoire — aucun merge auto. Review + merge manuel → tag `v*` → publish.yml.

- **R17a: GA ne merge jamais automatiquement**. Garde-fou supply chain. DRAFT PR attend review humaine qui inspecte valeurs pricing (détection attaque subtile type `pricing: 0.001`). Plage pricing R5 garde-fou minimum.

- **R18: js-yaml épinglé exact + package-lock committé**. `devDependencies.js-yaml` = `"4.1.0"`, `@types/js-yaml` = `"4.0.9"`. `package-lock.json` committé. Header `generated_with` dans `models.generated.ts` inclut versions exactes.

- **R19: `sideEffects` déclaré**. `"sideEffects": ["./dist/models.generated.js"]`. Empêche tree-shaking (esbuild/rollup/webpack). Test CI bundle avec treeshake agressif vérifie survie.

- **R20: Test boot CJS explicite**. CI test qui `require('@tanfeuille/bragi')` depuis CJS. Attendu : erreur claire actionnable (`ERR_REQUIRE_ESM` avec message FR renvoyant au README). Aligné `feedback_tsx_esm_cjs_boot_crash.md` (incident thor 20/04).

- **R21: Documentation install consommateurs précise**. README "Install consommateur" : (1) dev local sibling avec `npm run build` explicite avant install, (2) Dockerfile pattern `COPY package.json src tsconfig.json` + build dans builder stage, (3) Vercel `.npmrc` + `NPM_TOKEN` scope `read:packages` + diagnostic `npm whoami --registry=https://npm.pkg.github.com`.

- **R22: Coordination version consommateurs**. Chaque consommateur log au boot `[bragi] consumer=<name>, version=<semver>, urd_hash=<sha>, urd_date=<iso>` via `BRAGI_BUILD_METADATA`. Script ops `check-consumers-sync.mjs` query déploiements thor/bifrost via `/api/version`, alerte si drift ≥ 1 minor version.

---

## 5. Edge cases

### 5.1 Input boundary (fonctions publiques)

- **EC1: `getModelId(x)` avec x non-string** → `ModelNotFoundError` sanitizé, conversion safe via `try/String(x)/catch` anti-throw Symbol.
- **EC2: Chaîne vide ou whitespace-only** → `ModelNotFoundError` dédié. Pas de trim auto.
- **EC3: Caractères de contrôle / unicode** → sanitize via JSON.stringify + truncate 64 chars (R9a).
- **EC4: Très longue chaîne** → détection length > 32 avant interpolation. Protection DoS faible.
- **EC5: Modèle `disabled: true` demandé** → `ModelDisabledError` FR pointant `listActiveModels()`.
- **EC6: Nom canonique inconnu post-cast** → `ModelNotFoundError` avec liste noms disponibles, sans leak valeur brute suspecte.

### 5.2 Validation YAML (au sync-models)

- **EC7: Pricing manquant ou type invalide** → sync-models échoue, pointer ligne.
- **EC8: Pricing hors plage [0.1, 200]** → sync-models échoue sauf `--accept-pricing-change`.
- **EC9: Doublon `name` dans YAML** → sync-models échoue.
- **EC10: Champ inconnu dans YAML** → sync-models échoue (strict, pas silent ignore).
- **EC11: Secret littéral détecté** → sync-models échoue avec message "Secret littéral à remédier".
- **EC12: YAML tag dangereux** (`!!js/function`, `!!js/regexp`, `__proto__`) → rejeté via schema `CORE_SCHEMA`.
- **EC13: `config_version` absent ou ≠ 1** → sync-models échoue.
- **EC14: YAML avec BOM UTF-8 ou CRLF Windows** → normalisation R7e. Hash stable cross-OS.
- **EC15: YAML absent ou inaccessible** → sync-models exit 1 avec message actionnable.

### 5.3 Distribution / supply chain

- **EC16: `models.generated.ts` modifié manuellement post-sync** → self-check hash (R-SELFCHECK) lève `InvalidConfigError` au premier import runtime. CI `check-sync` bloque aussi pré-publish.
- **EC17: Hash embarqué OK mais contenu modifié malicieusement** → `check-sync` ne détecte pas, mais review humaine du DRAFT PR (R17a) inspecte. Plage pricing R5 garde-fou minimum.
- **EC18: Hash cross-OS diffère** (symlink OneDrive, BOM, CRLF) → normalisation R7e élimine.
- **EC19: sync-models race 2 devs parallèles** → resolve par régénération post-merge (jamais résolution manuelle). Hook git `post-merge` optionnel.
- **EC20: sync-models sur branch urd obsolète** → R13a check git status + warning.
- **EC21: Install via GitHub Packages sans NPM_TOKEN correct** → diagnostic README.

### 5.4 Runtime & bundling

- **EC22: ESM-only, consumer CJS** → erreur ESM avec message clair actionnable (R20 test dédié).
- **EC23: Bundler tree-shaking** → `sideEffects` protège (R19).
- **EC24: Worker threads / Next.js edge runtime** → chaque realm ré-évalue ESM indépendamment, chaque realm a sa propre instance frozen. Pas de singleton cross-realm. Cohérence garantie car `dist/models.generated.js` est statique identique.
- **EC25: Top-level await consumer init** (Next.js 14 `app/layout.tsx` TLA) → bragi est purement synchrone, compatible.
- **EC26: Multiples versions via deps transitives** → `instanceof BragiError` échoue cross-realm. Fallback : `error.code === "BRAGI_..."` (property tag).
- **EC27: Version figée pendant des mois** → `BRAGI_BUILD_METADATA.urd_updated_date` permet staleness check consumer.
- **EC28: Modèle deprecated upstream (Anthropic retire ID)** — v1.1 ajoute `deprecated_at` + `ModelDeprecatedError`. v1.0 = consommateur reçoit 404 SDK.
- **EC29: Tous modèles disabled** → `listActiveModels()` retourne `[]`, pas d'erreur. Consommateur gère UI warning.
- **EC30: Ajout modèle v2 consommé par code v1 avec switch exhaustif** → consommateur pin version mineure (`@tanfeuille/bragi@~0.1.0`) OU utilise `getDisplayName()` helper.

---

## 6. Exemples concrets

### Cas nominal — `getModelId` + usage SDK Anthropic

```ts
import { getModelId } from "@tanfeuille/bragi";
import Anthropic from "@anthropic-ai/sdk";

const id = getModelId("claude-sonnet");
// id: CanonicalModelId = "claude-sonnet-4-6" (union littérale, pas string)

const client = new Anthropic();
await client.messages.create({
  model: id,                   // pas de cast — type compatible SDK
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
```

### Cas nominal — UI Select via `listActiveModels` + `getDisplayName`

```tsx
import { listActiveModels, getDisplayName } from "@tanfeuille/bragi";

function ModelSelect() {
  const modeles = listActiveModels();
  return (
    <select>
      {modeles.map((m) => (
        <option key={m.name} value={m.name}>
          {getDisplayName(m.name)} — {m.pricing.input_per_million_eur} €/M in
        </option>
      ))}
    </select>
  );
}
```

### Cas nominal — validation input backend avec `isCanonicalModelName`

```ts
import { isCanonicalModelName, getModelId, CANONICAL_MODEL_NAMES } from "@tanfeuille/bragi";

export async function POST(req: Request) {
  const body = await req.json();

  if (!isCanonicalModelName(body.model)) {
    return Response.json(
      { error: "Invalid model name", valid: CANONICAL_MODEL_NAMES },
      { status: 400 }
    );
  }

  // body.model: CanonicalModelName ici (narrowing TS)
  const id = getModelId(body.model);
  // ...
}
```

### Cas nominal — traçabilité runtime

```ts
import { BRAGI_BUILD_METADATA } from "@tanfeuille/bragi";

console.log(`[bragi] consumer=thor-worker, version=${BRAGI_BUILD_METADATA.bragi_version}, urd_hash=${BRAGI_BUILD_METADATA.urd_hash.slice(0, 8)}, urd_date=${BRAGI_BUILD_METADATA.urd_updated_date}`);
// [bragi] consumer=thor-worker, version=0.1.0, urd_hash=a3b1c2d4, urd_date=2026-04-21
```

### Cas d'erreur — narrowing cross-realm via `code`

```ts
import { getModelId } from "@tanfeuille/bragi";

try {
  getModelId(userInput as any);
} catch (e) {
  // Pattern robuste cross-version (bragi v0.1.0 et v0.1.1 cohabitent)
  if (e && typeof e === "object" && "code" in e && typeof e.code === "string") {
    switch (e.code) {
      case "BRAGI_MODEL_NOT_FOUND":
        return res.status(400).json({ error: "Modèle inconnu" });
      case "BRAGI_MODEL_DISABLED":
        return res.status(503).json({ error: "Modèle temporairement indisponible" });
      case "BRAGI_INVALID_CONFIG":
        return res.status(500).json({ error: "Config bragi corrompue — contacter dev" });
    }
  }
  throw e;
}
```

### Cas procédure bump (opérationnel via GA auto)

```
1. Dev urd push un commit modifiant referentiels/models.yaml
2. GA auto-sync-from-urd.yml se déclenche sur urd
3. Checkout bragi branche auto-sync/urd-abc1234
4. npm run sync-models → diff détecté
5. bump auto patch (0.1.0 → 0.1.1) dans bragi package.json
6. Commit "chore(auto-sync): urd @abc1234"
7. Push + ouvre DRAFT PR sur bragi
8. Dev review le DRAFT PR (inspect diff YAML + TS, vérifier valeurs pricing)
9. Merge + tag v0.1.1 + push tag
10. CI publish.yml se déclenche → check-sync OK → build → test → npm publish
11. Consommateurs hermod/thor/bifrost upgradent à leur rythme
```

---

## 7. Dépendances & contraintes

### Techniques

- **Runtime Node** : `>=20`, ESM strict (`"type": "module"`), TS resolution `NodeNext`.
- **Target TS** : `ES2022`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- **Consommateurs minimum** : Node ≥20, target TS ≥ES2020.
- **Build** : `tsc` → `dist/` contient `*.js` + `*.d.ts`. **Aucun YAML dans `dist/`**.
- **Test runner** : `vitest ^4.1.2`.
- **Dépendances runtime** : **aucune**.
- **Dépendances dev** (pinned) :
  - `js-yaml` `"4.1.0"` (exact, script sync-models).
  - `@types/js-yaml` `"4.0.9"` (dev).
  - `typescript` `"^5.7.0"` (dev).
  - `vitest` `"^4.1.2"` (dev).
  - `@types/node` `"^22.0.0"` (dev).
- **Dépendances interdites** (verrou testé) :
  - PAS de `@anthropic-ai/sdk` (R11).
  - PAS de `langchain`, `langchain-core` ou autre SDK LLM.
  - PAS de `axios`, `node-fetch`, `undici` (R11a).
  - PAS de `@supabase/supabase-js`, `@google-cloud/*` (R11a).
  - PAS de `js-yaml` en `dependencies` (uniquement devDep, R11a).
- **`package-lock.json` committé** (R18).
- **Publication** : `@tanfeuille/bragi` sur `https://npm.pkg.github.com`. CI avec gate `check-sync` + lint + test + build + publish.
- **Install consommateurs** :
  - Dev sibling : `file:../wincorp-bragi` + `npm run build` explicite avant install (R21).
  - Prod hermod (thor via transitive) : `@tanfeuille/bragi@^X.Y.Z` GitHub Packages.
  - Prod bifrost (Vercel) : registry + `.npmrc` + `NPM_TOKEN` env var Production+Preview Sensitive ON.

### Performance

- Load initial (import + parse `as const` + construction Map/set/liste + self-check hash) : **< 10 ms** Node 20.
- Lookups ultérieurs : **< 0.1 ms** (Map.get / Set.has / référence partagée).
- Memory footprint : **< 5 KB** par instance singleton.

### Sécurité

- Jamais logger `MODELS_CONFIG` complet (R10).
- Stripping strict champs secrets au sync (R7, R7a, R7c).
- YAML parsing via `CORE_SCHEMA` exclusivement (R7b), lint CI bloque `yaml.load(` sans second arg.
- Pas d'accès filesystem ni réseau runtime (R11a, R11b, test dédié).
- Self-check hash premier import (R-SELFCHECK) détecte édition / corruption post-publish.
- Hook `block-secrets-commit.sh` actif.
- GA auto-sync DRAFT PR (pas merge auto, R17a).

---

## 8. Changelog

| Version | Date | Modification |
|---------|------|--------------|
| 1.0 | 2026-04-21 | Création initiale DRAFT (nom gungnir). Phase 10.1 Plan DeerFlow. Scope : 4 fonctions read-only, miroir Python odin. |
| 1.1 | 2026-04-21 | Révision post-audit adversarial 3 agents (type design + archi + edge cases). Renommage `gungnir` → `bragi` (cohérence sémantique : dieu de l'énumération ≠ lance). Séparation en 2 packages : bragi (config) + hermod (wrapper SDK). Corrections majeures : tuple `CANONICAL_MODEL_NAMES` + `isCanonicalModelName` guard, composition `capabilities`, erreurs avec `code` littéral, exports traçabilité `BRAGI_*`, helper `getDisplayName`, `CanonicalModelName` générée depuis YAML (urd autoritaire A1), self-check hash runtime (R-SELFCHECK), miroir invariants odin (R7-R7e), normalisation I/O cross-OS, GA auto-sync DRAFT PR (R17/R17a), sideEffects, test boot CJS, 30 edge cases couverts vs 16 en v1.0. |

---

## Questions ouvertes (hors spec v1.0)

- **Q1 — `pricing_valid_until` champ YAML optionnel** : warning runtime si pricing expiré. Candidat v1.1.
- **Q2 — `deprecated_at` + `ModelDeprecatedError`** : distinguer "désactivé admin" vs "deprecated upstream". Candidat v1.1.
- **Q3 — Support multi-provider** : structure YAML prête. v1.0 Anthropic only.
- **Q4 — Hot reload opt-in** : tests recharger config patchée. Rejeté v1.0.
- **Q5 — Brand type sur `ModelConfig`** : rendre synthèse hors-bragi impossible. Rejeté v1.0.
