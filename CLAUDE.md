# wincorp-bragi

**Yggdrasil** : Bragi — dieu de la poésie et de la mémoire des sagas. Porte la voix canonique des modèles LLM dans l'écosystème. Branche Tronc (transverse).

## Identité

Package TypeScript **read-only** qui expose la configuration canonique des modèles LLM de l'écosystème Yggdrasil. Lecture de `wincorp-urd/referentiels/models.yaml` comme source de vérité unique, hash SHA-256 anti-drift, pricing EUR.

**Zero dep runtime**. Peer dep consommée par `wincorp-hermod`.

## Canonicals exposés

- `claude-sonnet` → Claude 4.6 Sonnet
- `claude-haiku` → Claude 4.5 Haiku
- `claude-opus` → Claude 4.7 Opus

## Règles locales

- **Source de vérité unique** : `wincorp-urd/referentiels/models.yaml`. Jamais de hardcoding d'IDs modèles datés dans le code consommateur.
- **Sync obligatoire** : script `scripts/sync-models.ts` pour régénérer `src/models.generated.ts` depuis urd.
- **Read-only** : jamais d'écriture runtime. Pur lookup.
- **Publication** : GitHub Packages `npm.pkg.github.com/@tanfeuille/bragi` (public).

## Dépendance

- Consommateur principal : `wincorp-hermod` (peer dep).
- Consommateur direct : `wincorp-thor` (Image v2 + Achats + FEC), `wincorp-bifrost` (routes API).

## Documentation

Voir `README.md` pour usage détaillé et `specs/` pour contrat IMPLEMENTED.

## Convention commits

Conventional Commits FR (feat/fix/chore/docs/refactor/test). 1 commit = 1 changement logique.
