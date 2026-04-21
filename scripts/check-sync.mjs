// @spec specs/models-config.spec.md v1.1 R14 + R14a
// Script check-sync : gate CI pré-publish qui vérifie que le hash embarqué
// dans src/models.generated.ts correspond au hash SHA-256 normalisé de
// wincorp-urd/referentiels/models.yaml actuel.
//
// Usage :
//   node scripts/check-sync.mjs
//   node scripts/check-sync.mjs --urd-path=<chemin>
//   BRAGI_URD_PATH=<chemin> node scripts/check-sync.mjs
//
// Exit codes :
//   0 = OK (hash match OU mode "installed" sans urd — warning)
//   1 = divergence détectée (CI bloque publish)

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeYamlContent, sha256Hex } from "./sync-models.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BRAGI_ROOT = resolve(__dirname, "..");
const DEFAULT_URD_PATH = resolve(BRAGI_ROOT, "..", "wincorp-urd", "referentiels", "models.yaml");
const GENERATED_PATH = resolve(BRAGI_ROOT, "src", "models.generated.ts");

/**
 * Extrait la constante BRAGI_URD_HASH depuis le contenu TS généré.
 * Retourne null si absent.
 */
export function extractEmbeddedHash(tsContent) {
  const match = tsContent.match(/export\s+const\s+BRAGI_URD_HASH\s*=\s*"([a-f0-9]{64})"/);
  return match ? match[1] : null;
}

/**
 * Pipeline de check : compare hash embarqué vs hash urd actuel (normalisé).
 */
export async function checkSync({ urdPath = DEFAULT_URD_PATH } = {}) {
  // R14a — mode "installed" : urd absent → exit 0 avec warning
  if (!existsSync(urdPath)) {
    return {
      ok: true,
      mode: "installed",
      message:
        `wincorp-urd absent (${urdPath}). check-sync est un outil dev workspace, pas installed. ` +
        `Pour CI, utiliser BRAGI_URD_PATH explicite. OK silent.`,
    };
  }

  if (!existsSync(GENERATED_PATH)) {
    return {
      ok: false,
      mode: "no-generated",
      message:
        `src/models.generated.ts absent. Lancer d'abord : npm run sync-models`,
    };
  }

  const rawYaml = await readFile(urdPath, "utf8");
  const normalized = normalizeYamlContent(rawYaml);
  const currentHash = sha256Hex(normalized);

  const tsContent = await readFile(GENERATED_PATH, "utf8");
  const embeddedHash = extractEmbeddedHash(tsContent);

  if (embeddedHash == null) {
    return {
      ok: false,
      mode: "no-hash",
      message:
        `src/models.generated.ts ne contient pas BRAGI_URD_HASH (généré non conforme). ` +
        `Régénérer via : npm run sync-models`,
    };
  }

  if (embeddedHash !== currentHash) {
    return {
      ok: false,
      mode: "drift",
      embeddedHash,
      currentHash,
      message:
        `DRIFT : hash embarqué (${embeddedHash.slice(0, 8)}…) ≠ hash urd actuel (${currentHash.slice(0, 8)}…). ` +
        `Régénérer via : npm run sync-models + bump version + tag.`,
    };
  }

  return {
    ok: true,
    mode: "sync",
    embeddedHash,
    currentHash,
    message: `Hash aligné (${currentHash.slice(0, 8)}…). OK.`,
  };
}

// CLI
function parseCliArgs(argv) {
  const args = { urdPath: undefined };
  for (const a of argv) {
    if (a.startsWith("--urd-path=")) args.urdPath = a.slice("--urd-path=".length);
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const urdPath = args.urdPath || process.env.BRAGI_URD_PATH || DEFAULT_URD_PATH;

  let result;
  try {
    result = await checkSync({ urdPath });
  } catch (e) {
    console.error(`❌ check-sync : ${e.message}`);
    process.exit(1);
  }

  if (result.ok) {
    console.log(`✓ check-sync (${result.mode}) : ${result.message}`);
    process.exit(0);
  }

  console.error(`❌ check-sync (${result.mode}) : ${result.message}`);
  process.exit(1);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  main().catch((e) => {
    console.error(`❌ Erreur inattendue : ${e.message}`);
    if (process.env.BRAGI_DEBUG) console.error(e.stack);
    process.exit(1);
  });
}
