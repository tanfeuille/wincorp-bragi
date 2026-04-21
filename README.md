# @tanfeuille/bragi

**Bragi** — lookup helper TypeScript read-only pour la configuration des modèles LLM de l'écosystème Yggdrasil.

> Dans la mythologie nordique, Bragi est le dieu de la poésie, de l'éloquence et de la mémoire récitée. Ici, c'est le package TS qui énumère et récite la config des modèles Claude sans jamais les invoquer lui-même.

## Position dans Yggdrasil

**Tronc** (transverse). Miroir TypeScript du versant Python [`wincorp-odin`](https://github.com/tanfeuille/wincorp-odin). Même source de vérité YAML (`wincorp-urd/referentiels/models.yaml`), deux consommations distinctes :

- **Python** : [`wincorp-odin`](https://github.com/tanfeuille/wincorp-odin) — factory LangChain + circuit breaker + retry + tracking tokens.
- **TypeScript** : `@tanfeuille/bragi` (ce package) + `@tanfeuille/hermod` (wrapper SDK).

## Architecture des 2 packages TS

```
wincorp-urd (YAML source canonique)
    │
    │ sync-models + GitHub Action auto-sync
    ↓
@tanfeuille/bragi (config pure, zero-dep runtime)
    │
    │ dépendance npm
    ↓
@tanfeuille/hermod (wrapper @anthropic-ai/sdk)
    │
    │ dépendance npm
    ↓
wincorp-thor + wincorp-bifrost (consommateurs)
```

**Bragi** = données pures. Il lit la config LLM compilée au build et l'expose via des fonctions TS typées. **Aucune dépendance runtime**, pas de SDK Anthropic.

**Hermod** (dans [`wincorp-hermod`](https://github.com/tanfeuille/wincorp-hermod)) = actions. Il dépend de bragi + `@anthropic-ai/sdk` et fournit un client Claude unifié avec retry, timeout, métriques. Tous les appels Claude côté TS passent par hermod.

### Qui consomme quoi

- **Bragi seul** : bifrost UI ParametresTab (afficher la liste des modèles + pricing estimé, sans appeler Claude).
- **Bragi via hermod** : thor (pipeline Image/Achats/FEC) + bifrost routes API agents — tout ce qui appelle réellement Claude utilise hermod qui utilise bragi sous le capot.

**Bragi n'est PAS consommé par** [`wincorp-brokk`](https://github.com/tanfeuille/wincorp-brokk) (builder de payloads Fulll, pas d'appel LLM).

## Ce que fait Bragi

4 fonctions TS typées + exports de traçabilité. Config **compilée au build** (pas de YAML à runtime) :

```ts
import {
  getModelId,
  getPricing,
  getModelConfig,
  listActiveModels,
  isCanonicalModelName,
  GUNGNIR_VERSION,
  GUNGNIR_URD_HASH,
  GUNGNIR_URD_DATE,
} from "@tanfeuille/bragi";

getModelId("claude-sonnet");          // → "claude-sonnet-4-6"
getPricing("claude-haiku");           // → { input_per_million_eur: 0.92, output_per_million_eur: 4.60 }
getModelConfig("claude-opus");        // → objet complet typé
listActiveModels();                   // → tableau readonly des modèles non-disabled
isCanonicalModelName(req.body.model); // → type guard runtime pour validation UI
```

## Ce que Bragi NE fait PAS (verrous architecturaux)

- Pas de wrapping du SDK Anthropic — c'est hermod qui s'en charge (`@anthropic-ai/sdk` interdit dans bragi).
- Pas de circuit breaker / retry / tracking tokens runtime — côté Python odin pour l'orchestration lourde, côté TS hermod pour le retry simple.
- Pas de parsing YAML au runtime — config compilée au build via `npm run sync-models`.
- Pas de lecture de `api_key` — strippé au sync pour sécurité.
- Pas d'accès filesystem ou réseau au runtime — tout est statique dans `dist/`.

## Installation

### En dev local (mode sibling, rapide)

Le repo doit être cloné en sibling de ses consommateurs :

```
workspace/
├── wincorp-bragi/
├── wincorp-hermod/
├── wincorp-thor/
└── wincorp-bifrost/
```

Dans `wincorp-hermod/package.json` (ou thor/bifrost si consommation directe bragi) :

```json
{
  "dependencies": {
    "@tanfeuille/bragi": "file:../wincorp-bragi"
  }
}
```

Puis `npm install` normal.

### En prod (GitHub Packages)

Prérequis : un Personal Access Token GitHub classic avec scope `read:packages` (PAT).

**Côté consommateur** — créer `.npmrc` à la racine :

```
@tanfeuille:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

Ajouter la dépendance :

```json
{
  "dependencies": {
    "@tanfeuille/bragi": "^0.1.0"
  }
}
```

**Côté Vercel (bifrost)** — `NPM_TOKEN` ajouté aux env vars (Production + Preview, Sensitive ON).

**Côté Docker (thor)** — le Dockerfile fait un `COPY wincorp-bragi` sibling au build, même pattern que brokk.

## Mise à jour après MAJ urd (procédure bump)

Quand `wincorp-urd/referentiels/models.yaml` est modifié, le workflow recommandé est **automatique** via la GitHub Action `auto-sync-from-urd.yml` (côté urd) qui ouvre un DRAFT PR sur bragi avec le sync déjà appliqué.

Workflow manuel (si GA indisponible ou modif locale) :

1. **Sync local** :
   ```bash
   cd wincorp-bragi
   npm run sync-models
   ```
   Lit `../wincorp-urd/referentiels/models.yaml`, valide le schéma strict (miroir des règles odin), strippe les champs sensibles, et génère `src/models.generated.ts`. Affiche un diff FR si changement détecté.

2. **Inspecter le diff** :
   ```bash
   git diff src/models.generated.ts
   ```

3. **Bump version** dans `package.json` :
   - **patch** (0.1.0 → 0.1.1) : changement pricing, timeout, retry/CB params
   - **minor** (0.1.0 → 0.2.0) : ajout/retrait d'un modèle actif (élargit `CanonicalModelName`)
   - **major** (0.1.0 → 1.0.0) : breaking change API (rare)

4. **Commit + tag + push** :
   ```bash
   git add -A
   git commit -m "chore(sync): <description changement>"
   git tag v0.1.1
   git push origin main v0.1.1
   ```
   La CI `publish.yml` se déclenche sur le tag et publie automatiquement sur GitHub Packages.

5. **Consommateurs** : hermod + thor/bifrost upgradent à leur rythme (`npm update @tanfeuille/bragi`).

## Vérification d'intégrité en CI

`npm run check-sync` compare le hash SHA-256 embarqué dans `models.generated.ts` avec le hash actuel de `../wincorp-urd/referentiels/models.yaml`. Utilisé en gate pré-publish : un push de tag sur une version désynchronisée échoue avec erreur explicite.

## Développement

```bash
npm install
npm test
npm run test:watch
npm run build
npm run lint
```

## Spec

Voir `specs/models-config.spec.md` (SDD Niveau 2, DRAFT v1.1).

## Licence

UNLICENSED — usage interne WinCorp uniquement.
