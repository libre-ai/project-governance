# ADR-0052 — Amendement d'ADR-0025 : le statut d'une skill vit sous `metadata`, le frontmatter ne porte que les champs Agent Skills

- **Statut :** accepted — arbitrage propriétaire du 2026-10-14 en chat ; en
  vigueur à la fusion.
- **Arbitrage :** entre trois options présentées en question structurée
  (`metadata.status`, statut déplacé dans `eval.json`, statu quo documenté),
  le propriétaire a retenu `metadata.status`, l'option recommandée.
  Owner-arbitration: 2026-10-14 — statut des skills sous metadata.status,
  arbitré en chat
- **Date :** 2026-10-14
- **Portée :** frontmatter des `SKILL.md` de `skills/` et lint T1
  (`tools/skills/lint-skill.ts`).
- **Amende :** ADR-0025 D6 (emplacement de `status`). D1 à D5 restent
  inchangées, de même que l'énumération fermée `candidate` | `promoted` et la
  règle « aucun gate ne promeut ».
- **Décision :** D76 de `docs/decisions/DECISION-REGISTER.md`.

## Contexte — un échec observé

ADR-0025 D1 veut une skill copiable telle quelle dans un autre harnais, et D6
plaçait `status` au premier niveau du frontmatter. Le 2026-10-14, le
validateur de référence de la spec Agent Skills a refusé une skill de la
collection :

```
$ uvx --from skills-ref agentskills validate skills/rgpd-dpia
Validation failed for skills/rgpd-dpia:
  - Unexpected fields in frontmatter: status. Only ['allowed-tools',
    'compatibility', 'description', 'license', 'metadata', 'name'] are allowed.
```

Les huit skills admises portaient `status` au premier niveau. Claude Code
ignore une clé inconnue, et `claude plugin validate --strict` ne départage
donc pas les deux formes. Une surface qui applique les champs Agent Skills
(un upload sur claude.ai, par exemple) refusait la collection entière.

Cet échec remplit la barre d'ADR-0050 D1 pour la modification des huit
skills que cet ADR entraîne.

## Décision

### D1 — Le statut est `metadata.status`

`status` quitte le premier niveau et devient une entrée de `metadata`, le
champ que la spec Agent Skills réserve aux clés libres. L'énumération ne
change pas : `candidate` ou `promoted`. Le statut voyage avec la skill
copiée.

### D2 — Forme en bloc, seule admise

`metadata` s'écrit `metadata:` seul sur sa ligne, puis une ligne
`  clé: valeur` par entrée, indentée de deux espaces, valeurs scalaires. La
forme en ligne `metadata: { status: candidate }` est refusée : le validateur
de référence la rejette comme « disallowed JSONesque flow mapping » (mesuré
le 2026-10-14).

### D3 — Le premier niveau est fermé

T1 refuse toute clé de premier niveau hors des champs Agent Skills (`name`,
`description`, `license`, `compatibility`, `metadata`, `allowed-tools`), avec
une exception nommée : `disable-model-invocation`.

## Écart assumé

`disable-model-invocation: true` garde `deploy-clever` et `wizard`
user-invoked dans Claude Code, et le validateur de référence le refuse. Le
retirer d'une copie retirerait la garantie qu'un agent ne déclenche pas ces
skills de lui-même. Ces deux skills restent donc non portables telles
quelles vers une surface qui applique les champs Agent Skills.
`skills/README.md` le dit. Après cet ADR, les six autres skills passent le
validateur de référence.

## Conséquences

- Les huit `SKILL.md` passent à `metadata:` / `  status: candidate`.
- Le parser T1 admet ce seul bloc et rejette toute autre ligne indentée.
- `skills/README.md` remplace la limite connue sur `status` par la forme
  admise et l'écart de `disable-model-invocation`.

## Ce qui n'est pas décidé ici

- Un remplacement portable de `disable-model-invocation`. La spec Agent
  Skills n'en propose pas aujourd'hui.
