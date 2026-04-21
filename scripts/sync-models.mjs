// @spec specs/models-config.spec.md v1.1
// Script sync-models : lit wincorp-urd/referentiels/models.yaml, valide strict,
// strippe secrets, génère src/models.generated.ts avec hash SHA-256.
//
// Usage :
//   node scripts/sync-models.mjs
//   node scripts/sync-models.mjs --urd-path=<chemin>
//   node scripts/sync-models.mjs --force                   # skip git status check
//   node scripts/sync-models.mjs --accept-pricing-change   # allow pricing hors plage
//
// Exit codes :
//   0 = OK (idempotent ou régénéré)
//   1 = erreur validation / IO / git
//
// Le fichier est structuré comme module ESM exportant les fonctions pures pour tests
// dédiés (scripts/sync-models.test.ts, R13b). Le main() s'exécute uniquement quand
// le script est lancé directement (`node scripts/sync-models.mjs`).

import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BRAGI_ROOT = resolve(__dirname, "..");
const DEFAULT_URD_PATH = resolve(BRAGI_ROOT, "..", "wincorp-urd", "referentiels", "models.yaml");
const DEFAULT_OUTPUT_PATH = resolve(BRAGI_ROOT, "src", "models.generated.ts");

// =============================================================================
// Schéma attendu (miroir Pydantic odin, extra='forbid' — R7c)
// =============================================================================

const ALLOWED_ROOT_KEYS = new Set([
  "config_version", "source", "maintainer", "updated", "defaults", "models",
]);

const ALLOWED_DEFAULT_KEYS = new Set([
  "timeout", "max_retries", "supports_vision", "supports_reasoning_effort", "supports_thinking",
]);

const ALLOWED_MODEL_KEYS = new Set([
  "name", "display_name", "use", "model", "api_key", "max_tokens",
  "supports_thinking", "supports_vision", "supports_reasoning_effort",
  "timeout", "when_thinking_enabled", "when_thinking_disabled",
  "extra_kwargs", "disabled",
  "circuit_breaker", "retry", "pricing",
]);

// R7 — stripping strict champs secrets (clé)
const SECRET_KEY_PATTERN = /^(api_key|api_token|_token|secret|password|auth_header|authorization)$/i;

// R7 — rejet valeur littérale secret
const SECRET_VALUE_PATTERN = /^(sk-ant-|sk-|Bearer |AKIA|ghp_|github_pat_)/;

// R4 — whitelist name
const CANONICAL_NAME_REGEX = /^[a-z][a-z0-9-]{0,31}$/;

// R5 — plage pricing EUR/M
const PRICING_MIN = 0.1;
const PRICING_MAX = 200;

// R7d — tailles YAML
const YAML_SIZE_WARN = 50 * 1024;       // 50 KB
const YAML_SIZE_MAX = 1 * 1024 * 1024;  // 1 MB

// Versions pinned pour header generated_with (R18)
const JS_YAML_VERSION = "4.1.0";

// =============================================================================
// Fonctions pures (testables unitairement)
// =============================================================================

/**
 * Normalise le contenu YAML (R7e) : strip BOM UTF-8, convertit CRLF → LF,
 * trim trailing whitespace par ligne. Garantit hash identique cross-OS.
 */
export function normalizeYamlContent(raw) {
  let s = raw;
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  s = s.replace(/\r\n/g, "\n");
  s = s.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n");
  return s;
}

/**
 * Calcule le hash SHA-256 hex du contenu normalisé.
 */
export function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Parse YAML avec CORE_SCHEMA strict (R7b). Refuse tags custom.
 * @throws Error "Tag YAML non autorisé" si tag dangereux détecté.
 */
export function parseYamlStrict(content) {
  try {
    return yaml.load(content, { schema: yaml.CORE_SCHEMA });
  } catch (e) {
    throw new Error(`Échec parsing YAML (CORE_SCHEMA) : ${e.message}`);
  }
}

/**
 * Vérifie qu'un objet n'a que les clés attendues (R7c extra='forbid').
 * @throws Error avec pointer si champ inconnu.
 */
export function assertAllowedKeys(obj, allowed, context) {
  if (obj == null || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(`Champ inconnu '${key}' dans ${context} — autorisés : ${[...allowed].sort().join(", ")}`);
    }
  }
}

/**
 * Scanne récursivement pour détecter une valeur string matching SECRET_VALUE_PATTERN.
 * Emit pointer avec chemin dot-notation.
 * @throws Error "Secret littéral détecté" avec pointer.
 */
export function assertNoLiteralSecrets(value, path = "root") {
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) {
      throw new Error(`Secret littéral détecté à ${path} : commence par un préfixe reconnu (sk-ant-, sk-, Bearer, AKIA, ghp_, github_pat_). À remédier avant commit.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoLiteralSecrets(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertNoLiteralSecrets(v, `${path}.${k}`);
    }
  }
}

/**
 * Strippe récursivement les champs dont la clé matche SECRET_KEY_PATTERN (R7).
 * Retourne un nouvel objet, ne mute pas l'input.
 */
export function stripSecretKeys(value) {
  if (Array.isArray(value)) return value.map((v) => stripSecretKeys(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      out[k] = stripSecretKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Valide la structure d'un model YAML après parsing + stripping.
 * @throws Error avec pointer sur échec.
 */
export function validateModel(model, index, { acceptPricingChange = false } = {}) {
  if (!model || typeof model !== "object") {
    throw new Error(`models[${index}] n'est pas un objet`);
  }

  assertAllowedKeys(model, ALLOWED_MODEL_KEYS, `models[${index}]`);

  // R4 — name whitelist
  if (typeof model.name !== "string" || !CANONICAL_NAME_REGEX.test(model.name)) {
    throw new Error(`models[${index}].name invalide : '${model.name}' — attendu regex /^[a-z][a-z0-9-]{0,31}$/`);
  }

  if (typeof model.display_name !== "string" || model.display_name.length === 0) {
    throw new Error(`models[${index}].display_name manquant ou vide (modèle ${model.name})`);
  }

  if (typeof model.model !== "string" || model.model.length === 0) {
    throw new Error(`models[${index}].model (ID provider) manquant ou vide (modèle ${model.name})`);
  }

  if (typeof model.max_tokens !== "number" || !Number.isInteger(model.max_tokens) || model.max_tokens <= 0) {
    throw new Error(`models[${index}].max_tokens doit être un entier > 0 (modèle ${model.name})`);
  }

  if (typeof model.timeout !== "number" || model.timeout <= 0) {
    throw new Error(`models[${index}].timeout doit être un nombre > 0 (modèle ${model.name})`);
  }

  const disabled = model.disabled === true;

  // Pricing obligatoire si non-disabled (R5)
  if (!disabled) {
    if (!model.pricing || typeof model.pricing !== "object") {
      throw new Error(`models[${index}].pricing manquant (modèle ${model.name} non-disabled)`);
    }
    const pricingKeys = ["input_per_million_eur", "output_per_million_eur"];
    for (const pk of pricingKeys) {
      const v = model.pricing[pk];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(`models[${index}].pricing.${pk} doit être un nombre fini (modèle ${model.name})`);
      }
      if (!acceptPricingChange && (v < PRICING_MIN || v > PRICING_MAX)) {
        throw new Error(`models[${index}].pricing.${pk}=${v} hors plage [${PRICING_MIN}, ${PRICING_MAX}] EUR/M (modèle ${model.name}). Override via --accept-pricing-change.`);
      }
    }
  }

  // Capabilities — tous obligatoires en sortie (défaut false si absent dans YAML)
  for (const cap of ["supports_thinking", "supports_vision", "supports_reasoning_effort"]) {
    const v = model[cap];
    if (v !== undefined && typeof v !== "boolean") {
      throw new Error(`models[${index}].${cap} doit être booléen si présent (modèle ${model.name})`);
    }
  }

  // circuit_breaker : optionnel, null ou objet typé
  if (model.circuit_breaker != null) {
    if (typeof model.circuit_breaker !== "object") {
      throw new Error(`models[${index}].circuit_breaker doit être null ou objet (modèle ${model.name})`);
    }
    const cb = model.circuit_breaker;
    if (typeof cb.failure_threshold !== "number" || !Number.isInteger(cb.failure_threshold) || cb.failure_threshold < 1) {
      throw new Error(`models[${index}].circuit_breaker.failure_threshold doit être entier >= 1 (modèle ${model.name})`);
    }
    if (typeof cb.recovery_timeout_sec !== "number" || cb.recovery_timeout_sec <= 0) {
      throw new Error(`models[${index}].circuit_breaker.recovery_timeout_sec doit être nombre > 0 (modèle ${model.name})`);
    }
  }

  // retry : optionnel, null ou objet typé
  if (model.retry != null) {
    if (typeof model.retry !== "object") {
      throw new Error(`models[${index}].retry doit être null ou objet (modèle ${model.name})`);
    }
    const r = model.retry;
    if (typeof r.base_delay_sec !== "number" || r.base_delay_sec < 0) {
      throw new Error(`models[${index}].retry.base_delay_sec doit être nombre >= 0 (modèle ${model.name})`);
    }
    if (typeof r.cap_delay_sec !== "number" || r.cap_delay_sec < 0) {
      throw new Error(`models[${index}].retry.cap_delay_sec doit être nombre >= 0 (modèle ${model.name})`);
    }
    if (typeof r.max_attempts !== "number" || !Number.isInteger(r.max_attempts) || r.max_attempts < 1) {
      throw new Error(`models[${index}].retry.max_attempts doit être entier >= 1 (modèle ${model.name})`);
    }
  }
}

/**
 * Valide le document racine et retourne la liste de modèles normalisés prêts pour génération TS.
 * @throws Error sur toute violation.
 */
export function validateDocument(doc, options = {}) {
  if (!doc || typeof doc !== "object") {
    throw new Error("Document YAML racine invalide (pas un objet)");
  }

  assertAllowedKeys(doc, ALLOWED_ROOT_KEYS, "root");

  if (doc.config_version !== 1) {
    throw new Error(`config_version invalide : attendu 1, reçu ${JSON.stringify(doc.config_version)}`);
  }

  if (doc.defaults != null) {
    assertAllowedKeys(doc.defaults, ALLOWED_DEFAULT_KEYS, "defaults");
  }

  if (!Array.isArray(doc.models) || doc.models.length === 0) {
    throw new Error("'models' doit être un array non-vide");
  }

  const seenNames = new Set();
  doc.models.forEach((model, i) => {
    validateModel(model, i, options);
    if (seenNames.has(model.name)) {
      throw new Error(`Doublon de models[].name détecté : '${model.name}'`);
    }
    seenNames.add(model.name);
  });

  return doc.models;
}

/**
 * Transforme un modèle YAML brut en objet ModelConfig TS (renommage + composition).
 * Strippe déjà appliqué en amont.
 */
export function toModelConfig(rawModel) {
  const config = {
    name: rawModel.name,
    display_name: rawModel.display_name,
    id: rawModel.model,
    max_tokens: rawModel.max_tokens,
    timeout_sec: rawModel.timeout,
    capabilities: {
      supports_thinking: Boolean(rawModel.supports_thinking),
      supports_vision: Boolean(rawModel.supports_vision),
      supports_reasoning_effort: Boolean(rawModel.supports_reasoning_effort),
    },
    pricing: rawModel.pricing
      ? {
          input_per_million_eur: rawModel.pricing.input_per_million_eur,
          output_per_million_eur: rawModel.pricing.output_per_million_eur,
        }
      : null,
    circuit_breaker: rawModel.circuit_breaker
      ? {
          failure_threshold: rawModel.circuit_breaker.failure_threshold,
          recovery_timeout_sec: rawModel.circuit_breaker.recovery_timeout_sec,
        }
      : null,
    retry: rawModel.retry
      ? {
          base_delay_sec: rawModel.retry.base_delay_sec,
          cap_delay_sec: rawModel.retry.cap_delay_sec,
          max_attempts: rawModel.retry.max_attempts,
        }
      : null,
    disabled: rawModel.disabled === true,
  };
  return config;
}

/**
 * Sérialise un objet TS en littéral compatible `as const` (indentation 2).
 * Simple suffisant pour ModelConfig — pas de cycles, valeurs primitives + objets imbriqués.
 */
export function serializeAsConst(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const padInner = "  ".repeat(indent + 1);

  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => padInner + serializeAsConst(v, indent + 1));
    return "[\n" + items.join(",\n") + ",\n" + pad + "]";
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const items = entries.map(([k, v]) => `${padInner}${JSON.stringify(k)}: ${serializeAsConst(v, indent + 1)}`);
    return "{\n" + items.join(",\n") + ",\n" + pad + "}";
  }

  throw new Error(`Type non sérialisable : ${typeof value}`);
}

/**
 * Génère le contenu TS complet de models.generated.ts.
 */
export function generateTsContent({
  models,
  urdHash,
  urdDate,
  bragiVersion,
  nodeVersion = process.versions.node,
  jsYamlVersion = JS_YAML_VERSION,
  generatedAt = new Date().toISOString(),
}) {
  const configs = models.map(toModelConfig);
  const active = configs.filter((c) => !c.disabled);
  const canonicalNames = configs.map((c) => c.name);
  const canonicalIds = configs.map((c) => c.id);

  // Pour MODELS_CONFIG — on expose les configs (disabled inclus pour indexation interne)
  // mais les lookups publics filtreront / lèveront ModelDisabledError selon R6.
  // Ici on stocke tous, l'API distinguera.
  const modelsConfigLiteral = serializeAsConst(configs, 0);

  const modelsHash = sha256Hex(JSON.stringify(configs));

  return `// @generated — DO NOT EDIT MANUALLY
// @spec specs/models-config.spec.md v1.1
// generated_with: js-yaml@${jsYamlVersion}, bragi@${bragiVersion}, node@${nodeVersion}
// from urd hash ${urdHash}, at ${generatedAt}
//
// Pour régénérer : npm run sync-models depuis wincorp-bragi/
// Édition manuelle interdite — le self-check runtime (R-SELFCHECK) détecte
// toute divergence de hash au premier lookup et throw InvalidConfigError.

export const CANONICAL_MODEL_NAMES = ${serializeAsConst(canonicalNames, 0)} as const;

export type CanonicalModelName = (typeof CANONICAL_MODEL_NAMES)[number];

export const CANONICAL_MODEL_IDS = ${serializeAsConst(canonicalIds, 0)} as const;

export type CanonicalModelId = (typeof CANONICAL_MODEL_IDS)[number];

export const MODELS_CONFIG = ${modelsConfigLiteral} as const;

export const MODELS_CONFIG_HASH = ${JSON.stringify(modelsHash)} as const;

export const BRAGI_VERSION = ${JSON.stringify(bragiVersion)} as const;
export const BRAGI_URD_HASH = ${JSON.stringify(urdHash)} as const;
export const BRAGI_URD_DATE = ${JSON.stringify(urdDate)} as const;
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
    js_yaml: ${JSON.stringify(jsYamlVersion)},
    node: ${JSON.stringify(nodeVersion)},
    typescript: "5.7.x",
  },
  generated_at: ${JSON.stringify(generatedAt)},
} as const;

// Stat informatives (pas de garantie API publique — cf src/api.ts pour exports stables)
export const MODELS_ACTIVE_COUNT = ${active.length} as const;
export const MODELS_TOTAL_COUNT = ${configs.length} as const;
`;
}

// =============================================================================
// IO + orchestration (non-pur, testé via integration)
// =============================================================================

/**
 * Pipeline complet : lit YAML, normalise, valide, strippe, génère TS.
 * Retourne { urdHash, urdDate, tsContent, changed, diff }.
 */
export async function syncModels({
  urdPath = DEFAULT_URD_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  bragiVersion,
  acceptPricingChange = false,
  force = false,
  generatedAt,
} = {}) {
  // R13 étape 7 — urd absent
  if (!existsSync(urdPath)) {
    throw new Error(
      `Fichier urd introuvable : ${urdPath}\n` +
      `→ Vérifier que wincorp-urd est en sibling de wincorp-bragi.\n` +
      `→ Override via --urd-path=<chemin>.`
    );
  }

  // R7d — taille max
  const fileStat = await stat(urdPath);
  if (fileStat.size > YAML_SIZE_MAX) {
    throw new Error(
      `models.yaml fait ${fileStat.size} octets (>${YAML_SIZE_MAX}) — ` +
      `taille anormale, corruption probable.`
    );
  }
  const sizeWarn = fileStat.size > YAML_SIZE_WARN;

  const rawContent = await readFile(urdPath, "utf8");
  const normalizedContent = normalizeYamlContent(rawContent);
  const urdHash = sha256Hex(normalizedContent);

  const doc = parseYamlStrict(normalizedContent);

  // R7 — scan secrets littéraux AVANT stripping (sinon on perd l'info)
  assertNoLiteralSecrets(doc, "root");

  // R7 — strip secret keys après scan
  const stripped = stripSecretKeys(doc);

  // Validation structurelle
  const models = validateDocument(stripped, { acceptPricingChange });

  const urdDate = typeof stripped.updated === "string" ? stripped.updated : "unknown";

  const tsContent = generateTsContent({
    models,
    urdHash,
    urdDate,
    bragiVersion,
    generatedAt,
  });

  // Comparaison avec existant
  let currentContent = null;
  if (existsSync(outputPath)) {
    currentContent = await readFile(outputPath, "utf8");
  }
  const changed = currentContent !== tsContent;

  return {
    urdHash,
    urdDate,
    tsContent,
    changed,
    currentContent,
    sizeWarn,
    fileSize: fileStat.size,
    modelsCount: models.length,
    activeCount: models.filter((m) => !m.disabled).length,
  };
}

/**
 * R13a — Check git status de wincorp-urd avant sync.
 * Retourne { clean, ahead, warning }. Ne throw pas (non-bloquant).
 */
export function checkUrdGitStatus(urdPath = DEFAULT_URD_PATH) {
  try {
    const urdRepo = resolve(dirname(urdPath), "..");
    const porcelain = execFileSync("git", ["-C", urdRepo, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    const clean = porcelain.trim() === "";
    // Check HEAD vs origin/main — non-bloquant, tolère erreur (pas de remote)
    let ahead = null;
    try {
      const rev = execFileSync(
        "git",
        ["-C", urdRepo, "rev-list", "--left-right", "--count", "HEAD...origin/main"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }
      );
      const [aheadCount, behindCount] = rev.trim().split(/\s+/).map((n) => parseInt(n, 10));
      ahead = { aheadCount, behindCount };
    } catch {
      // pas de remote origin/main — silent
    }
    return { clean, ahead, error: null };
  } catch (e) {
    return { clean: null, ahead: null, error: e.message };
  }
}

// =============================================================================
// CLI main (exécuté si ce fichier est le point d'entrée)
// =============================================================================

function parseCliArgs(argv) {
  const args = { urdPath: undefined, force: false, acceptPricingChange: false };
  for (const a of argv) {
    if (a === "--force") args.force = true;
    else if (a === "--accept-pricing-change") args.acceptPricingChange = true;
    else if (a.startsWith("--urd-path=")) args.urdPath = a.slice("--urd-path=".length);
  }
  return args;
}

async function readBragiVersion() {
  const pkgPath = resolve(BRAGI_ROOT, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  return pkg.version;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const urdPath = args.urdPath || DEFAULT_URD_PATH;

  // R13a — check git status urd
  if (!args.force) {
    const git = checkUrdGitStatus(urdPath);
    if (git.error) {
      console.warn(`⚠  Impossible de vérifier git status urd : ${git.error}`);
      console.warn(`   Skip via --force pour ignorer.`);
    } else if (git.clean === false) {
      console.warn(`⚠  wincorp-urd a des modifications non committées.`);
      console.warn(`   Considère committer avant sync-models, ou utilise --force.`);
    }
    if (git.ahead && git.ahead.behindCount > 0) {
      console.warn(`⚠  wincorp-urd est en retard de ${git.ahead.behindCount} commit(s) par rapport à origin/main.`);
    }
  }

  const bragiVersion = await readBragiVersion();

  let result;
  try {
    result = await syncModels({
      urdPath,
      bragiVersion,
      acceptPricingChange: args.acceptPricingChange,
      force: args.force,
    });
  } catch (e) {
    console.error(`❌ sync-models : ${e.message}`);
    process.exit(1);
  }

  const relOut = relative(process.cwd(), DEFAULT_OUTPUT_PATH);

  if (result.sizeWarn) {
    console.warn(`⚠  models.yaml fait ${result.fileSize} octets (> 50 KB) — taille inhabituelle, vérifier.`);
  }

  if (!result.changed) {
    console.log(`✓ ${relOut} à jour (urd hash ${result.urdHash.slice(0, 8)}).`);
    console.log(`  ${result.activeCount} modèles actifs / ${result.modelsCount} total.`);
    process.exit(0);
  }

  await writeFile(DEFAULT_OUTPUT_PATH, result.tsContent, "utf8");
  console.log(`✓ ${relOut} régénéré depuis urd hash ${result.urdHash.slice(0, 8)}.`);
  console.log(`  ${result.activeCount} modèles actifs / ${result.modelsCount} total.`);
  console.log(``);
  console.log(`  → Prochaine étape : inspecter diff, bump version (patch/minor/major), commit+tag+push.`);
  process.exit(0);
}

// Détection point d'entrée (import vs exécution directe)
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  main().catch((e) => {
    console.error(`❌ Erreur inattendue : ${e.message}`);
    if (process.env.BRAGI_DEBUG) console.error(e.stack);
    process.exit(1);
  });
}
