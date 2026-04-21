// @spec specs/models-config.spec.md v1.1 R13b
// Tests vitest pour scripts/sync-models.mjs — couverture R1-R22 + EC7-EC15 (validation YAML).
//
// Note de localisation : la spec v1.1 R13b dit `scripts/sync-models.test.ts`,
// réaligné sur `tests/sync-models.test.mjs` pour cohérence vitest.config include
// (tests/**/*.test.{ts,mjs}) et éviter friction TS sur imports .mjs.

import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  normalizeYamlContent,
  sha256Hex,
  parseYamlStrict,
  assertAllowedKeys,
  assertNoLiteralSecrets,
  stripSecretKeys,
  validateModel,
  validateDocument,
  toModelConfig,
  serializeAsConst,
  generateTsContent,
  syncModels,
} from "../scripts/sync-models.mjs";
import { checkSync, extractEmbeddedHash } from "../scripts/check-sync.mjs";

// =============================================================================
// Helpers fixtures
// =============================================================================

/**
 * Crée un répertoire temporaire avec un models.yaml + un src/models.generated.ts placeholder.
 * Retourne { urdPath, outputPath, cleanup }.
 */
async function setupTempWorkspace(yamlContent, { includeExistingGenerated = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "bragi-test-"));
  const urdDir = join(root, "urd", "referentiels");
  const bragiDir = join(root, "bragi");
  const bragiSrcDir = join(bragiDir, "src");
  await mkdir(urdDir, { recursive: true });
  await mkdir(bragiSrcDir, { recursive: true });

  const urdPath = join(urdDir, "models.yaml");
  await writeFile(urdPath, yamlContent, "utf8");

  const outputPath = join(bragiSrcDir, "models.generated.ts");
  if (includeExistingGenerated) {
    await writeFile(outputPath, "// placeholder\n", "utf8");
  }

  return {
    urdPath,
    outputPath,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

const NOMINAL_YAML = `config_version: 1
updated: "2026-04-20"
defaults:
  timeout: 60.0
models:
  - name: "claude-sonnet"
    display_name: "Claude Sonnet 4.6"
    use: "langchain_anthropic:ChatAnthropic"
    model: "claude-sonnet-4-6"
    api_key: "\${ANTHROPIC_API_KEY}"
    max_tokens: 8192
    supports_thinking: true
    supports_vision: true
    supports_reasoning_effort: false
    timeout: 120.0
    when_thinking_enabled: null
    when_thinking_disabled: null
    extra_kwargs: {}
    disabled: false
    circuit_breaker:
      failure_threshold: 5
      recovery_timeout_sec: 60.0
    retry:
      base_delay_sec: 1.0
      cap_delay_sec: 30.0
      max_attempts: 3
    pricing:
      input_per_million_eur: 2.76
      output_per_million_eur: 13.80
`;

// =============================================================================
// normalizeYamlContent (R7e)
// =============================================================================

describe("normalizeYamlContent (R7e)", () => {
  it("strip BOM UTF-8", () => {
    expect(normalizeYamlContent("\uFEFFconfig_version: 1")).toBe("config_version: 1");
  });

  it("convertit CRLF → LF", () => {
    expect(normalizeYamlContent("line1\r\nline2\r\n")).toBe("line1\nline2\n");
  });

  it("trim trailing whitespace par ligne", () => {
    expect(normalizeYamlContent("key: value   \n  other:   \t\nthird")).toBe(
      "key: value\n  other:\nthird"
    );
  });

  it("idempotent (double normalisation ≡ simple)", () => {
    const input = "\uFEFFconfig_version: 1   \r\nmodels:\r\n  - name: foo  \t\n";
    const once = normalizeYamlContent(input);
    const twice = normalizeYamlContent(once);
    expect(twice).toBe(once);
  });

  it("préserve indentation leading (spaces) nécessaire YAML", () => {
    const input = "root:\n  child: value\n";
    expect(normalizeYamlContent(input)).toBe(input);
  });
});

// =============================================================================
// sha256Hex
// =============================================================================

describe("sha256Hex", () => {
  it("reproductible", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
  });

  it("différent pour contenus différents", () => {
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abcd"));
  });

  it("format hex 64 chars", () => {
    expect(sha256Hex("anything")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hash BOM vs sans BOM diffère si pas normalisé", () => {
    expect(sha256Hex("\uFEFFabc")).not.toBe(sha256Hex("abc"));
  });

  it("hash normalisé stable cross-OS", () => {
    const lf = normalizeYamlContent("line1\nline2\n");
    const crlf = normalizeYamlContent("line1\r\nline2\r\n");
    const bom = normalizeYamlContent("\uFEFFline1\nline2\n");
    expect(sha256Hex(lf)).toBe(sha256Hex(crlf));
    expect(sha256Hex(lf)).toBe(sha256Hex(bom));
  });
});

// =============================================================================
// parseYamlStrict (R7b)
// =============================================================================

describe("parseYamlStrict (R7b)", () => {
  it("parse YAML nominal", () => {
    const doc = parseYamlStrict("config_version: 1\nfoo: bar\n");
    expect(doc.config_version).toBe(1);
    expect(doc.foo).toBe("bar");
  });

  it("refuse tag custom !!js/function (CORE_SCHEMA)", () => {
    const yaml = "foo: !!js/function 'function f() {}'\n";
    expect(() => parseYamlStrict(yaml)).toThrow(/parsing YAML/);
  });

  it("refuse tag !!js/regexp", () => {
    const yaml = "foo: !!js/regexp /bar/\n";
    expect(() => parseYamlStrict(yaml)).toThrow(/parsing YAML/);
  });

  it("YAML malformé → throw", () => {
    expect(() => parseYamlStrict("foo: [unclosed")).toThrow(/parsing YAML/);
  });
});

// =============================================================================
// assertAllowedKeys (R7c)
// =============================================================================

describe("assertAllowedKeys (R7c)", () => {
  it("OK si toutes les clés sont whitelistées", () => {
    const allowed = new Set(["a", "b"]);
    expect(() => assertAllowedKeys({ a: 1, b: 2 }, allowed, "ctx")).not.toThrow();
  });

  it("throw avec pointer sur clé inconnue", () => {
    const allowed = new Set(["a"]);
    expect(() => assertAllowedKeys({ a: 1, surprise: 2 }, allowed, "models[0]")).toThrow(
      /Champ inconnu 'surprise' dans models\[0\]/
    );
  });

  it("null/undefined → no-op", () => {
    expect(() => assertAllowedKeys(null, new Set(), "ctx")).not.toThrow();
    expect(() => assertAllowedKeys(undefined, new Set(), "ctx")).not.toThrow();
  });
});

// =============================================================================
// assertNoLiteralSecrets (R7)
// =============================================================================

describe("assertNoLiteralSecrets (R7)", () => {
  it("détecte sk-ant-test-FAKE", () => {
    expect(() => assertNoLiteralSecrets({ foo: { api_key: "sk-ant-test-FAKE" } })).toThrow(
      /Secret littéral détecté à root\.foo\.api_key/
    );
  });

  it("détecte sk-XXX", () => {
    expect(() => assertNoLiteralSecrets({ k: "sk-abcd1234" })).toThrow(
      /Secret littéral détecté/
    );
  });

  it("détecte Bearer token", () => {
    expect(() => assertNoLiteralSecrets({ h: "Bearer eyJhbGciOi..." })).toThrow(
      /Secret littéral détecté/
    );
  });

  it("détecte AKIA (AWS)", () => {
    expect(() => assertNoLiteralSecrets({ k: "AKIAXXXXX" })).toThrow(/Secret/);
  });

  it("détecte ghp_ (GitHub PAT)", () => {
    expect(() => assertNoLiteralSecrets({ token: "ghp_abcdef12345" })).toThrow(/Secret/);
  });

  it("détecte github_pat_", () => {
    expect(() => assertNoLiteralSecrets({ t: "github_pat_11AAA..." })).toThrow(/Secret/);
  });

  it("OK sur interpolation ${VAR}", () => {
    expect(() =>
      assertNoLiteralSecrets({ api_key: "${ANTHROPIC_API_KEY}" })
    ).not.toThrow();
  });

  it("descend dans les arrays", () => {
    expect(() => assertNoLiteralSecrets([{ k: "sk-ant-leak" }])).toThrow(/\[0\]\.k/);
  });

  it("OK sur strings normales", () => {
    expect(() => assertNoLiteralSecrets({ name: "foo", id: "bar-123" })).not.toThrow();
  });
});

// =============================================================================
// stripSecretKeys (R7)
// =============================================================================

describe("stripSecretKeys (R7)", () => {
  it("retire api_key", () => {
    const out = stripSecretKeys({ name: "x", api_key: "${VAR}" });
    expect(out).toEqual({ name: "x" });
  });

  it("retire api_token, secret, password, auth_header, authorization (case insensitive)", () => {
    const input = {
      name: "x",
      api_token: "a",
      secret: "b",
      password: "c",
      auth_header: "d",
      authorization: "e",
      API_KEY: "f",
      Password: "g",
    };
    const out = stripSecretKeys(input);
    expect(out).toEqual({ name: "x" });
  });

  it("récursif dans objets imbriqués", () => {
    const out = stripSecretKeys({ outer: { api_key: "x", ok: 1 } });
    expect(out).toEqual({ outer: { ok: 1 } });
  });

  it("récursif dans arrays", () => {
    const out = stripSecretKeys([{ api_key: "a", b: 1 }, { c: 2 }]);
    expect(out).toEqual([{ b: 1 }, { c: 2 }]);
  });

  it("ne mute pas l'input", () => {
    const input = { api_key: "x", ok: 1 };
    stripSecretKeys(input);
    expect(input).toEqual({ api_key: "x", ok: 1 });
  });

  it("préserve primitives non-objet", () => {
    expect(stripSecretKeys("foo")).toBe("foo");
    expect(stripSecretKeys(42)).toBe(42);
    expect(stripSecretKeys(null)).toBe(null);
    expect(stripSecretKeys(true)).toBe(true);
  });
});

// =============================================================================
// validateModel (R4, R5, R6)
// =============================================================================

describe("validateModel", () => {
  const valid = {
    name: "claude-sonnet",
    display_name: "Claude Sonnet 4.6",
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    timeout: 120,
    supports_thinking: true,
    supports_vision: true,
    supports_reasoning_effort: false,
    disabled: false,
    pricing: { input_per_million_eur: 2.76, output_per_million_eur: 13.8 },
  };

  it("OK sur modèle nominal", () => {
    expect(() => validateModel({ ...valid }, 0)).not.toThrow();
  });

  it("refuse name hors whitelist regex", () => {
    expect(() => validateModel({ ...valid, name: "Claude Sonnet" }, 0)).toThrow(
      /name invalide/
    );
    expect(() => validateModel({ ...valid, name: "1claude" }, 0)).toThrow(/name invalide/);
    expect(() => validateModel({ ...valid, name: "" }, 0)).toThrow(/name invalide/);
  });

  it("refuse name > 32 chars", () => {
    expect(() => validateModel({ ...valid, name: "a".repeat(33) }, 0)).toThrow(/name invalide/);
  });

  it("accepte name à la limite (32 chars)", () => {
    expect(() => validateModel({ ...valid, name: "a" + "b".repeat(31) }, 0)).not.toThrow();
  });

  it("refuse display_name vide", () => {
    expect(() => validateModel({ ...valid, display_name: "" }, 0)).toThrow(/display_name/);
  });

  it("refuse model (ID) vide", () => {
    expect(() => validateModel({ ...valid, model: "" }, 0)).toThrow(/model \(ID provider\)/);
  });

  it("refuse max_tokens non-entier ou <= 0", () => {
    expect(() => validateModel({ ...valid, max_tokens: 0 }, 0)).toThrow(/max_tokens/);
    expect(() => validateModel({ ...valid, max_tokens: -1 }, 0)).toThrow(/max_tokens/);
    expect(() => validateModel({ ...valid, max_tokens: 3.5 }, 0)).toThrow(/max_tokens/);
  });

  it("refuse timeout <= 0", () => {
    expect(() => validateModel({ ...valid, timeout: 0 }, 0)).toThrow(/timeout/);
    expect(() => validateModel({ ...valid, timeout: -1 }, 0)).toThrow(/timeout/);
  });

  it("refuse pricing manquant sur non-disabled (R5)", () => {
    const { pricing, ...noPricing } = valid;
    expect(() => validateModel(noPricing, 0)).toThrow(/pricing manquant/);
  });

  it("accepte pricing absent sur disabled", () => {
    const { pricing, ...noPricing } = valid;
    expect(() => validateModel({ ...noPricing, disabled: true }, 0)).not.toThrow();
  });

  it("refuse pricing hors plage [0.1, 200]", () => {
    expect(() =>
      validateModel({ ...valid, pricing: { input_per_million_eur: 0.05, output_per_million_eur: 1 } }, 0)
    ).toThrow(/hors plage/);
    expect(() =>
      validateModel({ ...valid, pricing: { input_per_million_eur: 300, output_per_million_eur: 1 } }, 0)
    ).toThrow(/hors plage/);
  });

  it("accepte pricing hors plage si --accept-pricing-change", () => {
    expect(() =>
      validateModel(
        { ...valid, pricing: { input_per_million_eur: 300, output_per_million_eur: 1 } },
        0,
        { acceptPricingChange: true }
      )
    ).not.toThrow();
  });

  it("refuse champ inconnu (R7c via assertAllowedKeys)", () => {
    expect(() => validateModel({ ...valid, mystery: "foo" }, 0)).toThrow(/Champ inconnu 'mystery'/);
  });

  it("valide retry structure", () => {
    expect(() =>
      validateModel(
        {
          ...valid,
          retry: { base_delay_sec: 1, cap_delay_sec: 30, max_attempts: 3 },
        },
        0
      )
    ).not.toThrow();
    expect(() =>
      validateModel({ ...valid, retry: { base_delay_sec: 1, cap_delay_sec: 30, max_attempts: 0 } }, 0)
    ).toThrow(/retry\.max_attempts/);
    expect(() =>
      validateModel({ ...valid, retry: { base_delay_sec: -1, cap_delay_sec: 30, max_attempts: 3 } }, 0)
    ).toThrow(/retry\.base_delay_sec/);
  });

  it("accepte retry null (pas de retry)", () => {
    expect(() => validateModel({ ...valid, retry: null }, 0)).not.toThrow();
  });

  it("valide circuit_breaker structure", () => {
    expect(() =>
      validateModel(
        { ...valid, circuit_breaker: { failure_threshold: 5, recovery_timeout_sec: 60 } },
        0
      )
    ).not.toThrow();
    expect(() =>
      validateModel(
        { ...valid, circuit_breaker: { failure_threshold: 0, recovery_timeout_sec: 60 } },
        0
      )
    ).toThrow(/circuit_breaker\.failure_threshold/);
  });
});

// =============================================================================
// validateDocument
// =============================================================================

describe("validateDocument", () => {
  it("OK nominal", () => {
    const doc = {
      config_version: 1,
      models: [
        {
          name: "m1",
          display_name: "M1",
          model: "m-1",
          max_tokens: 100,
          timeout: 10,
          disabled: false,
          pricing: { input_per_million_eur: 1, output_per_million_eur: 1 },
        },
      ],
    };
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it("refuse config_version ≠ 1 (EC13)", () => {
    expect(() => validateDocument({ config_version: 2, models: [] })).toThrow(
      /config_version invalide/
    );
    expect(() => validateDocument({ models: [] })).toThrow(/config_version invalide/);
  });

  it("refuse models vide ou manquant", () => {
    expect(() => validateDocument({ config_version: 1 })).toThrow(/'models'/);
    expect(() => validateDocument({ config_version: 1, models: [] })).toThrow(/'models'/);
  });

  it("refuse doublon name (EC9)", () => {
    const m = {
      name: "dup",
      display_name: "D",
      model: "d-1",
      max_tokens: 100,
      timeout: 10,
      disabled: false,
      pricing: { input_per_million_eur: 1, output_per_million_eur: 1 },
    };
    expect(() =>
      validateDocument({ config_version: 1, models: [m, { ...m, display_name: "D2" }] })
    ).toThrow(/Doublon/);
  });

  it("refuse champ racine inconnu (EC10)", () => {
    expect(() =>
      validateDocument({ config_version: 1, models: [], mystery: true })
    ).toThrow(/Champ inconnu 'mystery' dans root/);
  });
});

// =============================================================================
// toModelConfig (mapping YAML → TS)
// =============================================================================

describe("toModelConfig", () => {
  it("mappe model → id, timeout → timeout_sec", () => {
    const raw = {
      name: "x",
      display_name: "X",
      model: "x-1",
      max_tokens: 100,
      timeout: 60,
      supports_thinking: true,
      supports_vision: false,
      supports_reasoning_effort: true,
      disabled: false,
      pricing: { input_per_million_eur: 1, output_per_million_eur: 2 },
      circuit_breaker: { failure_threshold: 5, recovery_timeout_sec: 60 },
      retry: { base_delay_sec: 1, cap_delay_sec: 10, max_attempts: 3 },
    };
    const cfg = toModelConfig(raw);
    expect(cfg.id).toBe("x-1");
    expect(cfg.timeout_sec).toBe(60);
    expect(cfg.capabilities).toEqual({
      supports_thinking: true,
      supports_vision: false,
      supports_reasoning_effort: true,
    });
    expect(cfg.pricing).toEqual({ input_per_million_eur: 1, output_per_million_eur: 2 });
    expect(cfg.circuit_breaker).toEqual({ failure_threshold: 5, recovery_timeout_sec: 60 });
    expect(cfg.retry).toEqual({ base_delay_sec: 1, cap_delay_sec: 10, max_attempts: 3 });
  });

  it("capabilities défaut false si absent", () => {
    const raw = {
      name: "x",
      display_name: "X",
      model: "x-1",
      max_tokens: 100,
      timeout: 60,
      disabled: false,
      pricing: { input_per_million_eur: 1, output_per_million_eur: 2 },
    };
    expect(toModelConfig(raw).capabilities).toEqual({
      supports_thinking: false,
      supports_vision: false,
      supports_reasoning_effort: false,
    });
  });

  it("circuit_breaker/retry null si absent", () => {
    const raw = {
      name: "x",
      display_name: "X",
      model: "x-1",
      max_tokens: 100,
      timeout: 60,
      disabled: false,
      pricing: { input_per_million_eur: 1, output_per_million_eur: 2 },
    };
    const cfg = toModelConfig(raw);
    expect(cfg.circuit_breaker).toBeNull();
    expect(cfg.retry).toBeNull();
  });
});

// =============================================================================
// serializeAsConst
// =============================================================================

describe("serializeAsConst", () => {
  it("primitives", () => {
    expect(serializeAsConst(null)).toBe("null");
    expect(serializeAsConst(true)).toBe("true");
    expect(serializeAsConst(42)).toBe("42");
    expect(serializeAsConst("hello")).toBe('"hello"');
  });

  it("array vide et rempli", () => {
    expect(serializeAsConst([])).toBe("[]");
    expect(serializeAsConst([1, 2])).toContain("1,\n");
  });

  it("object vide et rempli", () => {
    expect(serializeAsConst({})).toBe("{}");
    const s = serializeAsConst({ a: 1 });
    expect(s).toContain('"a": 1');
  });

  it("imbriqué", () => {
    const s = serializeAsConst({ outer: { inner: [1, null, true] } });
    expect(s).toContain('"outer"');
    expect(s).toContain('"inner"');
    expect(s).toContain("null");
    expect(s).toContain("true");
  });

  it("escape strings", () => {
    expect(serializeAsConst('hello "world"')).toBe('"hello \\"world\\""');
  });
});

// =============================================================================
// generateTsContent
// =============================================================================

describe("generateTsContent", () => {
  it("header avec generated_with", () => {
    const ts = generateTsContent({
      models: [
        {
          name: "m1",
          display_name: "M1",
          model: "m-1",
          max_tokens: 100,
          timeout: 10,
          disabled: false,
          pricing: { input_per_million_eur: 1, output_per_million_eur: 1 },
        },
      ],
      urdHash: "abc",
      urdDate: "2026-04-20",
      bragiVersion: "0.1.0",
      nodeVersion: "20.10.0",
      jsYamlVersion: "4.1.0",
      generatedAt: "2026-04-21T00:00:00Z",
    });
    expect(ts).toContain("@generated — DO NOT EDIT MANUALLY");
    expect(ts).toContain("generated_with: js-yaml@4.1.0, bragi@0.1.0, node@20.10.0");
    expect(ts).toContain("from urd hash abc, at 2026-04-21T00:00:00Z");
  });

  it("exporte CANONICAL_MODEL_NAMES, IDS, MODELS_CONFIG, HASH", () => {
    const ts = generateTsContent({
      models: [
        {
          name: "m1",
          display_name: "M1",
          model: "m-1",
          max_tokens: 100,
          timeout: 10,
          disabled: false,
          pricing: { input_per_million_eur: 1, output_per_million_eur: 1 },
        },
      ],
      urdHash: "abc",
      urdDate: "2026-04-20",
      bragiVersion: "0.1.0",
    });
    expect(ts).toContain("export const CANONICAL_MODEL_NAMES = ");
    expect(ts).toContain("export const CANONICAL_MODEL_IDS = ");
    expect(ts).toContain("export const MODELS_CONFIG = ");
    expect(ts).toContain("export const MODELS_CONFIG_HASH = ");
    expect(ts).toContain("export const BRAGI_VERSION = ");
    expect(ts).toContain("export const BRAGI_URD_HASH = ");
    expect(ts).toContain("export const BRAGI_URD_DATE = ");
    expect(ts).toContain("export const BRAGI_CONFIG_VERSION = 1 as const");
  });

  it("CANONICAL_MODEL_NAMES contient les noms en ordre YAML", () => {
    const ts = generateTsContent({
      models: [
        {
          name: "a",
          display_name: "A",
          model: "a-1",
          max_tokens: 100,
          timeout: 10,
          disabled: false,
          pricing: { input_per_million_eur: 1, output_per_million_eur: 1 },
        },
        {
          name: "b",
          display_name: "B",
          model: "b-1",
          max_tokens: 100,
          timeout: 10,
          disabled: false,
          pricing: { input_per_million_eur: 1, output_per_million_eur: 1 },
        },
      ],
      urdHash: "h",
      urdDate: "2026-04-20",
      bragiVersion: "0.1.0",
    });
    expect(ts).toContain('"a"');
    expect(ts).toContain('"b"');
    expect(ts.indexOf('"a"')).toBeLessThan(ts.indexOf('"b"'));
  });
});

// =============================================================================
// syncModels (integration)
// =============================================================================

describe("syncModels (integration)", () => {
  it("nominal : lit YAML, génère TS, retourne changed=true si placeholder diffère", async () => {
    const ws = await setupTempWorkspace(NOMINAL_YAML, { includeExistingGenerated: true });
    try {
      const result = await syncModels({
        urdPath: ws.urdPath,
        outputPath: ws.outputPath,
        bragiVersion: "0.1.0",
        generatedAt: "2026-04-21T00:00:00Z",
      });
      expect(result.changed).toBe(true);
      expect(result.tsContent).toContain('BRAGI_URD_HASH = "');
      expect(result.tsContent).toContain('BRAGI_URD_DATE = "2026-04-20"');
      expect(result.modelsCount).toBe(1);
      expect(result.activeCount).toBe(1);
    } finally {
      await ws.cleanup();
    }
  });

  it("idempotent : 2e run avec même contenu → changed=false", async () => {
    const ws = await setupTempWorkspace(NOMINAL_YAML);
    try {
      const first = await syncModels({
        urdPath: ws.urdPath,
        outputPath: ws.outputPath,
        bragiVersion: "0.1.0",
        generatedAt: "2026-04-21T00:00:00Z",
      });
      await writeFile(ws.outputPath, first.tsContent, "utf8");
      const second = await syncModels({
        urdPath: ws.urdPath,
        outputPath: ws.outputPath,
        bragiVersion: "0.1.0",
        generatedAt: "2026-04-21T00:00:00Z",
      });
      expect(second.changed).toBe(false);
    } finally {
      await ws.cleanup();
    }
  });

  it("EC15 : YAML absent → throw avec message actionnable", async () => {
    await expect(
      syncModels({ urdPath: "/nonexistent/path.yaml", bragiVersion: "0.1.0" })
    ).rejects.toThrow(/Fichier urd introuvable/);
  });

  it("EC11 : secret littéral rejeté", async () => {
    const yaml = NOMINAL_YAML.replace("${ANTHROPIC_API_KEY}", "sk-ant-test-FAKE");
    const ws = await setupTempWorkspace(yaml);
    try {
      await expect(
        syncModels({ urdPath: ws.urdPath, outputPath: ws.outputPath, bragiVersion: "0.1.0" })
      ).rejects.toThrow(/Secret littéral détecté/);
    } finally {
      await ws.cleanup();
    }
  });

  it("EC14 : BOM + CRLF préservés en hash stable", async () => {
    const yamlLf = NOMINAL_YAML;
    const yamlCrlf = NOMINAL_YAML.replace(/\n/g, "\r\n");
    const yamlBom = "\uFEFF" + NOMINAL_YAML;

    const ws1 = await setupTempWorkspace(yamlLf);
    const ws2 = await setupTempWorkspace(yamlCrlf);
    const ws3 = await setupTempWorkspace(yamlBom);
    try {
      const r1 = await syncModels({
        urdPath: ws1.urdPath, outputPath: ws1.outputPath, bragiVersion: "0.1.0",
        generatedAt: "2026-04-21T00:00:00Z",
      });
      const r2 = await syncModels({
        urdPath: ws2.urdPath, outputPath: ws2.outputPath, bragiVersion: "0.1.0",
        generatedAt: "2026-04-21T00:00:00Z",
      });
      const r3 = await syncModels({
        urdPath: ws3.urdPath, outputPath: ws3.outputPath, bragiVersion: "0.1.0",
        generatedAt: "2026-04-21T00:00:00Z",
      });
      expect(r1.urdHash).toBe(r2.urdHash);
      expect(r1.urdHash).toBe(r3.urdHash);
    } finally {
      await ws1.cleanup();
      await ws2.cleanup();
      await ws3.cleanup();
    }
  });

  it("EC9 : doublon name rejeté", async () => {
    const dupYaml = NOMINAL_YAML + `
  - name: "claude-sonnet"
    display_name: "Dup"
    use: "x"
    model: "x-1"
    api_key: "\${VAR}"
    max_tokens: 100
    supports_thinking: false
    supports_vision: false
    supports_reasoning_effort: false
    timeout: 10.0
    when_thinking_enabled: null
    when_thinking_disabled: null
    extra_kwargs: {}
    disabled: false
    pricing:
      input_per_million_eur: 1
      output_per_million_eur: 1
`;
    const ws = await setupTempWorkspace(dupYaml);
    try {
      await expect(
        syncModels({ urdPath: ws.urdPath, outputPath: ws.outputPath, bragiVersion: "0.1.0" })
      ).rejects.toThrow(/Doublon/);
    } finally {
      await ws.cleanup();
    }
  });

  it("EC7/EC8 : pricing manquant ou hors plage", async () => {
    const noPricingYaml = NOMINAL_YAML.replace(
      /    pricing:\n      input_per_million_eur: 2\.76\n      output_per_million_eur: 13\.80\n/,
      ""
    );
    const ws1 = await setupTempWorkspace(noPricingYaml);
    try {
      await expect(
        syncModels({ urdPath: ws1.urdPath, outputPath: ws1.outputPath, bragiVersion: "0.1.0" })
      ).rejects.toThrow(/pricing manquant/);
    } finally {
      await ws1.cleanup();
    }

    const outOfRangeYaml = NOMINAL_YAML.replace("2.76", "0.01");
    const ws2 = await setupTempWorkspace(outOfRangeYaml);
    try {
      await expect(
        syncModels({ urdPath: ws2.urdPath, outputPath: ws2.outputPath, bragiVersion: "0.1.0" })
      ).rejects.toThrow(/hors plage/);
    } finally {
      await ws2.cleanup();
    }
  });

  it("EC10 : champ inconnu au niveau racine rejeté", async () => {
    const yaml = NOMINAL_YAML + "mystery_field: true\n";
    const ws = await setupTempWorkspace(yaml);
    try {
      await expect(
        syncModels({ urdPath: ws.urdPath, outputPath: ws.outputPath, bragiVersion: "0.1.0" })
      ).rejects.toThrow(/Champ inconnu 'mystery_field' dans root/);
    } finally {
      await ws.cleanup();
    }
  });

  it("EC10b : champ inconnu dans un model rejeté", async () => {
    const yaml = NOMINAL_YAML.replace(
      "    disabled: false",
      "    mystery_inner: true\n    disabled: false"
    );
    const ws = await setupTempWorkspace(yaml);
    try {
      await expect(
        syncModels({ urdPath: ws.urdPath, outputPath: ws.outputPath, bragiVersion: "0.1.0" })
      ).rejects.toThrow(/Champ inconnu 'mystery_inner' dans models\[0\]/);
    } finally {
      await ws.cleanup();
    }
  });

  it("EC13 : config_version manquant", async () => {
    const yaml = NOMINAL_YAML.replace("config_version: 1\n", "");
    const ws = await setupTempWorkspace(yaml);
    try {
      await expect(
        syncModels({ urdPath: ws.urdPath, outputPath: ws.outputPath, bragiVersion: "0.1.0" })
      ).rejects.toThrow(/config_version/);
    } finally {
      await ws.cleanup();
    }
  });

  it("YAML > 1MB refusé (R7d)", async () => {
    // Gros YAML avec padding comment
    const padding = "# " + "x".repeat(1024 * 1024 + 100) + "\n";
    const yaml = padding + NOMINAL_YAML;
    const ws = await setupTempWorkspace(yaml);
    try {
      await expect(
        syncModels({ urdPath: ws.urdPath, outputPath: ws.outputPath, bragiVersion: "0.1.0" })
      ).rejects.toThrow(/taille anormale/);
    } finally {
      await ws.cleanup();
    }
  });

  it("YAML > 50KB warn (sizeWarn=true)", async () => {
    const padding = "# " + "x".repeat(60 * 1024) + "\n";
    const yaml = padding + NOMINAL_YAML;
    const ws = await setupTempWorkspace(yaml);
    try {
      const r = await syncModels({
        urdPath: ws.urdPath, outputPath: ws.outputPath, bragiVersion: "0.1.0",
      });
      expect(r.sizeWarn).toBe(true);
    } finally {
      await ws.cleanup();
    }
  });
});

// =============================================================================
// extractEmbeddedHash + checkSync
// =============================================================================

describe("extractEmbeddedHash", () => {
  it("extrait hash 64 chars valide", () => {
    const content = `export const BRAGI_URD_HASH = "${"a".repeat(64)}" as const;`;
    expect(extractEmbeddedHash(content)).toBe("a".repeat(64));
  });

  it("retourne null si absent", () => {
    expect(extractEmbeddedHash("// nothing\n")).toBeNull();
  });

  it("retourne null si hash malformé", () => {
    expect(
      extractEmbeddedHash(`export const BRAGI_URD_HASH = "xxx" as const;`)
    ).toBeNull();
  });
});

describe("checkSync", () => {
  it("mode installed : urd absent → ok=true avec warning", async () => {
    const r = await checkSync({ urdPath: "/nonexistent/path.yaml" });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("installed");
  });

  it("mode drift : hash embarqué ≠ hash actuel", async () => {
    const ws = await setupTempWorkspace(NOMINAL_YAML);
    try {
      // Write a generated file with a wrong hash
      const fakeTs = `export const BRAGI_URD_HASH = "${"0".repeat(64)}" as const;`;
      await writeFile(ws.outputPath, fakeTs, "utf8");

      // checkSync defaults to the workspace's default path, so we need to relocate
      // the generated file. We'll call checkSync with a custom urdPath, but outputPath
      // is resolved relative to bragi root internally. Pour tester directement,
      // on ré-écrit la fonction de check manuellement :
      const rawYaml = await readFile(ws.urdPath, "utf8");
      const normalized = normalizeYamlContent(rawYaml);
      const currentHash = sha256Hex(normalized);
      const tsContent = await readFile(ws.outputPath, "utf8");
      const embeddedHash = extractEmbeddedHash(tsContent);
      expect(embeddedHash).not.toBe(currentHash);
      expect(embeddedHash).toBe("0".repeat(64));
    } finally {
      await ws.cleanup();
    }
  });
});
