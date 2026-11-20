<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0072 — Amendement d'ADR-0025 : l'état d'admission d'une skill se calcule depuis ses preuves, lié à l'empreinte de son répertoire

- **Statut :** accepted — décision de principe du propriétaire du 2026-11-20 ; les choix de rédaction listés à la section « Acte de signature » n'entrent en vigueur qu'à la fusion de cette pull request par le propriétaire, qui vaut signature (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-11-20 — page de décision structurée, tenue dans la session qui porte cette pull request, sur les résultats du drill de l'outil tiers `NVIDIA/SkillEvaluator` ; réponse « Ouvrir un lot » (libellé choisi sur la page, pas une phrase de la main du propriétaire) au mécanisme « statut d'admission dérivé des preuves, lié à l'empreinte de la source ». L'arbitrage porte sur le principe, pas sur le texte de cet ADR.
- **Date de rédaction :** 2026-11-20
- **Connexes :** ADR-0050 D1 (une skill ne change que sur un échec observé : motif de D5) et ADR-0050 D7 (manifeste généré, tenu égal par un gate : modèle du reçu) ; ADR-0068 (n'autorise aucune promotion de skill par un agent : inchangé) ; ADR-0056 D4 (un tiers se cite épinglé) ; `docs/method/SKILLS-ANATOMY.md` et `skills/README.md`, qui disent à qui écrit ou copie une skill quoi régénérer et quoi comparer.
- **Amende :** ADR-0025 D6 (l'état `candidate` n'est plus une déclaration de l'auteur, il se calcule ; l'énumération fermée et la promotion comme acte du propriétaire restent) ; ADR-0053 D1 (`metadata.status` garde sa place et sa forme, mais comme copie de l'état dérivé, tenue égale par un gate) ; ADR-0050 D3 (les signes `working_if` et leur constat par le propriétaire restent, mais ils ne suffisent plus : une promotion écrite comme D3 la décrit, `status: promoted` et `working_if`, passe T1 et fait échouer le gate de D4 tant que l'enregistrement de D6 n'existe pas).
- **Invariants :** I-25 (appliqué : son texte ne change pas, il ne fixe ni l'emplacement du statut ni la façon de l'établir) ; I-17 (appliqué : la liste des contrôles requis entre sur la surface à touche humaine, la promotion reste un acte du propriétaire). Aucun invariant n'est inscrit par cette rédaction.

## Vérification empirique

- **Prémisse :** l'état des skills de la collection est écrit à la main, et il vaut partout `candidate`.
- **Commande :** `grep -h '^  status:' skills/*/SKILL.md | sort | uniq -c`
- **Date de rejeu :** 2026-11-20
- **Sortie attendue :** `8   status: candidate`.

- **Prémisse :** avant cet ADR, aucun outil de la collection ne hache un fichier de skill ni ne conserve le résultat d'un contrôle.
- **Commande :** `git grep -n -i -E 'sha-?256|createHash|CryptoHasher' <base> -- tools/skills`, où `<base>` est le commit de la branche servie dont part cette pull request
- **Date de rejeu :** 2026-11-20
- **Sortie attendue :** aucune ligne.

- **Prémisse :** la recette d'empreinte de D1 se rejoue avec les outils du système, sans le code de ce dépôt.
- **Commande :** depuis `skills/biscuit-auth`, `{ printf 'libre-ai.skill-fingerprint.v1\n'; LC_ALL=C find . -type f | cut -c3- | LC_ALL=C sort | while IFS= read -r p; do x=-; [ -n "$(find "$p" -perm -u+x)" ] && x=x; printf 'file %s %s %s:%s\n' "$x" "$(shasum -a 256 "$p" | cut -d' ' -f1)" "$(printf '%s' "$p" | wc -c | tr -d ' ')" "$p"; done; } | shasum -a 256`, comparé à `jq -r '.skills[] | select(.name == "biscuit-auth") | .fingerprint' ecosystem/projections/skills-admission.v1.json`
- **Date de rejeu :** 2026-11-20
- **Sortie attendue :** le même condensé des deux côtés, précédé de `sha256:` dans le reçu. La commande vaut pour des chemins en ASCII ; elle ne normalise pas en NFC.

Une prémisse n'a pas été rejouée : que le validateur de référence Agent Skills admette toute clé sous `metadata`. Elle est **inférée** de la mesure d'ADR-0053 (2026-10-14) ; la rejouer demande d'installer ce validateur, ce que cette rédaction ne fait pas. D5 ne change ni la clé ni sa forme.

## Contexte

**Ce que le dépôt tient.** ADR-0025 D6 ferme le statut d'une skill à `candidate` ou `promoted`, et ADR-0053 le place sous `metadata.status`. Le lint T1 en vérifie la forme (`tools/skills/lint-skill.ts:181`). Cinq contrôles jugent une skill : T1 (structure), T2 (routage), T3 (non-cascade), T4 (sécurité du contenu) et le manifeste de distribution.

**Ce qui manque.** Rien ne relie ces contrôles au mot écrit dans le frontmatter. Une skill modifiée garde `candidate` sans qu'aucun contrôle ait relu ses nouveaux octets ; un contrôle retiré de la chaîne ne change l'état d'aucune skill. T4 en est le cas présent : il n'est dans aucun agrégat (`tools/skills/check-skills-security.test.ts:498-506`), et les huit skills se disent admises sans lui. Aucun résultat de contrôle n'est conservé, aucun n'est lié à ce qui a été contrôlé.

**D'où vient l'idée.** Le drill du 2026-11-20 a lu un outil tiers qui calcule un statut de publication depuis ses preuves et le lie à une empreinte de l'arbre source. Idées seulement, aucun texte repris :

- une empreinte versionnée faite des chemins, des types de nœud, des bits d'exécution et des condensés de contenu, à champs préfixés par leur longueur : `NVIDIA/SkillEvaluator@35af6d9:src/skillevaluator/publication_identity.py:621-627` ;
- une politique des niveaux requis qui se résout en « requis » dès qu'elle est invalide, contradictoire ou absente : `NVIDIA/SkillEvaluator@35af6d9:src/skillevaluator/reporting/base.py:1872-1985` ;
- un statut `incomplete` distinct d'un échec, donné à ce qui n'a pas pu être contrôlé.

**Ce que cet ADR ne reprend pas de l'outil.** Son empreinte garde les trois bits d'exécution (`NVIDIA/SkillEvaluator@35af6d9:src/skillevaluator/publication_identity.py:386`) et dépend donc de l'umask du clone. Son code de sortie ne lit jamais son statut de publication (`NVIDIA/SkillEvaluator@35af6d9:src/skillevaluator/cli.py:3132-3158`) : une exécution sort 0 avec un statut `incomplete`. Un niveau qui ne déclare pas ses contrôles requis n'est pas contrôlé du tout (`NVIDIA/SkillEvaluator@35af6d9:src/skillevaluator/reporting/base.py:2069-2070`). D1, D4 et D3 font l'inverse sur ces trois points.

**Origine.** Un défaut trouvé par inspection, pas un échec observé en session : aucune skill n'a été admise à tort à ce jour.

## Décision

### D1 — Chaque skill a une empreinte, par une recette versionnée

L'empreinte d'une skill est celle de son répertoire `skills/<nom>/`, calculée par la recette `libre-ai.skill-fingerprint.v1`, écrite dans `tools/skills/skill-fingerprint.ts` :

1. **Ce qui est haché :** chaque fichier régulier du répertoire, à toute profondeur, quel que soit son nom. Rien n'est exclu. Un répertoire est parcouru et n'est pas un enregistrement : git ne suit aucun répertoire vide.
2. **Un enregistrement par fichier :** le type de nœud (`file`, le seul admis) ; le bit d'exécution du **propriétaire seul** (`x` ou `-`), de sorte que l'empreinte ne dépend pas de l'umask ; le SHA-256 du contenu ; le chemin relatif au répertoire, séparé par `/`, en Unicode NFC.
3. **La préimage :** une ligne qui nomme la recette, puis une ligne par enregistrement, `file <x|-> <sha256> <longueur du chemin en octets>:<chemin>`, les enregistrements triés par les octets UTF-8 de leur chemin. Le chemin vient en dernier, préfixé par sa longueur : un chemin qui contient un espace ou un saut de ligne ne se lit pas comme un autre enregistrement.
4. **L'empreinte :** `sha256:` suivi du SHA-256 de la préimage.
5. **Ce qui est refusé, nommé, jamais sauté :** un lien symbolique (le répertoire lui-même compris, jamais suivi), une entrée qui n'est ni fichier ni répertoire, une entrée illisible, deux chemins qui n'en font qu'un une fois normalisés. Un répertoire qui porte un seul refus n'a pas d'empreinte.

Changer un de ces cinq points est une nouvelle version de la recette, sous un nouveau nom.

### D2 — Un reçu d'admission, généré et suivi

`bun run build:skills-admission` écrit `ecosystem/projections/skills-admission.v1.json`. Le reçu dit, pour chaque skill : son nom, son empreinte, le nombre de fichiers hachés, chaque contrôle connu avec son caractère requis et son résultat, et l'état dérivé. Il nomme la recette. Il ne porte ni date ni chemin de poste : deux générations sur le même arbre rendent les mêmes octets.

Un résultat vaut `pass`, `fail` ou `unavailable`. `unavailable` dit que le contrôle n'a pas pu juger : sa fonction a levé une erreur, ou sa propre source (les motifs de T4, le manifeste) ne se lit pas. Ce n'est ni un succès ni un zéro.

Le reçu se génère entier ou pas du tout. Rien n'est écrit quand une skill n'a pas d'empreinte, quand une entrée de `skills/` est refusée, quand un fichier de `skills/` n'est pas suivi par git (D4, point 6), ou quand la liste des contrôles requis n'est pas suivie telle qu'écrite (D3, règle 2).

Le code de sortie du générateur est le verdict du gate de D4 sur ce qu'il vient d'écrire. Un reçu qui porte un état `incomplete` est un reçu fidèle, et un reçu que le gate refuse : il est écrit, les constats du gate sont imprimés, et le générateur sort en échec. Il ne sort jamais 0 sur un état qu'il sait rouge.

### D3 — L'état se dérive des contrôles requis

Cinq contrôles sont connus. Deux rendent le verdict de la fonction que leur gate appelle ; trois sont un verdict par skill, composé dans `tools/skills/build-skills-admission.ts` à partir des pièces d'un gate qui juge la collection entière :

| Contrôle | Gate | Ce qui est appelé | Écart avec le gate |
| --- | --- | --- | --- |
| `structure` | T1 | `lintSkillDirectory`, la fonction du gate | aucun |
| `non-cascade` | T3 | `evaluateNonCascade`, la fonction du gate | aucun |
| `routing` | T2 | composé : `gradeRoutingCases` (chaque déclencheur positif de la skill sort premier, au plancher par défaut) et `pairwiseOverlap` (sa description ne heurte aucune autre) | la variable d'environnement qui abaisse le plancher n'est pas lue ; l'assemblage par skill n'existe pas dans le gate |
| `security` | T4 | composé : `loadSkillTree` (chaque entrée du répertoire est du texte lisible) et `scanForSkillRisks` (aucune ligne ne correspond à un motif refusé) | l'assemblage par skill n'existe pas dans le gate |
| `distribution` | manifeste | `listedSkills` : le manifeste suivi liste la skill | plus étroit : le gate du manifeste, lui, tient le fichier égal octet pour octet à celui qu'il génère |

Un changement de l'un de ces gates qui ne passe pas par ces fonctions ne change pas le reçu : c'est un écart à relire à chaque modification de T2, de T4 ou du gate du manifeste.

`tools/skills/skills-admission-policy.v1.json` liste les contrôles **requis**. L'état d'une skill est :

- `candidate` quand chaque contrôle requis a rendu `pass` sur son empreinte ;
- `incomplete` dans tout autre cas : un contrôle requis en échec, un contrôle requis qui n'a pas pu juger, un contrôle requis sans résultat.

Trois règles ferment la dérivation :

1. **Ne pas lancer un contrôle n'est jamais une dispense.** Le script lance tous les contrôles connus, et aucun de ses arguments n'en choisit, n'en saute ni n'en dispense un.
2. **Une liste illisible ou contradictoire vaut « tout est requis », et le gate échoue en nommant le défaut.** Les deux à la fois : chaque contrôle connu devient requis pour le calcul des états, et le gate reste rouge tant que le fichier n'est pas réparé. Sont des défauts : un fichier illisible ou qui n'est pas du JSON ; une liste absente ou vide ; un contrôle inconnu ; un contrôle listé deux fois ; un fichier qui ne se relit pas tel qu'écrit, espaces à part (une clé écrite deux fois, dont un parseur ne garde que la dernière sans rien dire, ou un nom de clé caché derrière un échappement) ; une clé autre que `schema_version`, `because` et `required_checks` ; un `schema_version` autre que `libre-ai.skills-admission-policy.v1`.
3. **La liste est sur la surface à touche humaine.** En retirer un contrôle admet toutes les skills sur moins de preuves : le fichier entre dans `GATED_PATH_PATTERNS` de `tools/quality/check-review-evidence.ts`.

Un contrôle connu que la liste ne requiert pas est quand même lancé et son résultat écrit, sans compter. Les cinq sont requis aujourd'hui.

### D4 — Un gate tient le reçu égal à l'arbre

`bun run check:skills-admission`, dans `bun run check`, échoue en nommant la skill quand :

1. un répertoire de skill n'a pas d'empreinte (D1, point 5) ;
2. le reçu suivi n'est pas celui que l'arbre produit : un octet changé dans un fichier de skill sans régénération suffit ;
3. le statut qu'une skill déclare n'est pas son état dérivé (D5) ;
4. la liste des contrôles requis n'est pas suivie telle qu'écrite (D3, règle 2) ;
5. le reçu est absent, illisible, ou nomme une skill qui n'est plus sous `skills/` ;
6. un fichier présent sous `skills/` n'est pas suivi par git, qu'il soit ignoré ou jamais ajouté : il est refusé par son nom, et la skill qui le contient n'a pas d'empreinte. Haché, il donnerait une empreinte qu'aucun clone ne peut rendre : le reçu régénéré sur le poste serait vert sur le poste et rouge en CI, sur le même commit. La question est posée à git (`git ls-files --others`, sans `--exclude-standard`) ; si git ne répond pas, parce que l'arbre n'est pas un dépôt, c'est un échec nommé, et le compteur dit `unreadable`, jamais zéro ;
7. aucune skill n'est trouvée sous `skills/`, même si le reçu suivi est celui, vide, que cet arbre génère.

Le motif d'un écart dit ce qui est à faire. Quand l'état dérivé est `candidate`, c'est régénérer le reçu. Quand il est `incomplete`, régénérer ne rend jamais le vert : le message nomme le contrôle qui ne passe pas, à réparer dans la skill ou dans le contrôle.

Il imprime ce qu'il a examiné : entrées de `skills/` (skills, autres entrées, refusées), skills avec et sans empreinte, fichiers hachés, fichiers non suivis, contrôles requis sur contrôles connus, états. Chaque nombre est compté pour lui-même et les sommes se vérifient. Les entrées de `skills/` qui ne sont pas des skills sont nommées sur cette ligne, à chaque exécution : un répertoire dont le `SKILL.md` manque ou est mal orthographié sort de la collection par cette porte, et un compte seul ne le montrerait pas.

### D5 — `metadata.status` reste dans le frontmatter, comme copie de l'état dérivé

Le statut écrit à la main ne peut plus contredire l'état dérivé : le gate de D4 exige l'égalité. La clé reste où ADR-0053 l'a mise, dans la même forme, avec la même énumération au lint T1.

Deux conséquences de l'égalité :

- le frontmatter ne peut pas dire `incomplete` (T1 le refuse), donc une skill `incomplete` rend le gate rouge. Contrairement à l'outil tiers, aucun vert ne porte une skill dont un contrôle requis n'a pas passé ;
- le frontmatter suit l'état dérivé, jamais l'inverse : on corrige la skill ou le contrôle, pas le mot.

Motif du choix, contre la sortie de la clé : la retirer modifierait les huit skills sans échec observé, ce qu'ADR-0050 D1 interdit quelle que soit la taille du changement ; et rien de ce que la distribution lit n'en dépend. Lu le 2026-11-20 : le manifeste ne porte que des chemins de répertoire (`.claude-plugin/marketplace.json`), et `skills/README.md` fait copier le répertoire tel quel. Le validateur de référence admet la clé parce qu'elle est sous `metadata` (inféré d'ADR-0053, non rejoué).

### D6 — `promoted` reste un acte humain, et se liera à l'empreinte

Cet ADR ne promeut aucune skill et ne donne à aucun outil le moyen d'en promouvoir une. Le script ne dérive que `candidate` et `incomplete`.

Une promotion se prononce sur une empreinte. Sa forme, quand elle sera construite : un enregistrement écrit par le propriétaire, dans un fichier gardé comme la liste de D3, qui nomme la skill, l'empreinte promue, la date et la source du constat des signes `working_if` (ADR-0050 D3). L'état `promoted` ne se dérive que si cette empreinte est celle du répertoire **et** que chaque contrôle requis a passé. Dès que la skill change, l'empreinte ne correspond plus : l'état retombe à `candidate` ou `incomplete`, et le gate de D4 oblige la pull request qui change la skill à réécrire `metadata.status`. La rétrogradation se lit dans le diff de la skill ; la promotion suivante est un nouvel acte sur la nouvelle empreinte.

Cet enregistrement n'existe pas. Tant qu'il n'existe pas, une skill qui déclare `promoted` fait échouer le gate, avec ce motif. Aucune skill n'est `promoted` à ce jour.

C'est un amendement d'ADR-0050 D3, pas seulement un complément. D3 dit que le propriétaire promeut en citant le constat des signes dans le changeset et qu'aucun gate ne fait la promotion ; depuis cet ADR, un gate la **refuse** : une pull request du propriétaire qui écrit `status: promoted` avec ses `working_if`, conforme à D3 et verte en T1, rend `bun run check` rouge. La promotion est suspendue jusqu'au lot qui construit l'enregistrement.

### D7 — Ce qui ne change pas

ADR-0025 D1 à D5 ; ADR-0050 hors D3 (D1, D2, D4 à D8) ; dans ADR-0050 D3, la forme de `working_if` et sa vérification par T1 ; les quatre gates T1 à T4 et le gate du manifeste, qui gardent leurs codes de sortie. L'entrée de T4 dans `bun run check` n'est pas décidée ici.

## Conséquences

- Toute pull request qui touche un fichier sous `skills/<nom>/` régénère le reçu. `docs/method/SKILLS-ANATOMY.md` et `skills/README.md` le disent.
- Les résultats du reçu sont ceux du code et des données de contrôle du commit qui le porte. Ajouter un motif à T4, déplacer un seuil de T2 ou modifier le manifeste peut changer un résultat sans qu'aucune empreinte bouge. Aujourd'hui les cinq contrôles sont requis et valent tous `pass` : le seul changement possible est donc un contrôle requis qui cesse de passer, l'état devient `incomplete`, et régénérer le reçu ne rend pas le vert. Le gate reste rouge jusqu'à ce que la skill ou le contrôle soit réparé ; son message nomme le contrôle. Régénérer ne suffit que le jour où un contrôle **non requis** change de résultat, ce qu'aucune politique ne permet à ce jour.
- `routing` juge une skill contre la collection. Une skill ajoutée peut faire échouer le routage d'une autre, dont l'empreinte n'a pas changé.
- T4 compte parmi les contrôles requis alors qu'il est hors de l'agrégat sur la base. Un échec de T4 rend donc `bun run check` rouge par ce gate, par l'écart entre le statut déclaré et l'état dérivé. Aujourd'hui T4 passe sur les huit skills.
- L'empreinte se prend sur le répertoire, pas sur l'index git, et le gate refuse qu'ils diffèrent par un fichier : un fichier non suivi laissé sous `skills/` (un `.DS_Store`, un journal ignoré) rend le gate rouge sur ce poste, par son nom, et le générateur n'écrit rien. Un clone neuf du même commit ne porte pas ce fichier et reste vert : l'écart de verdict dit l'écart entre l'arbre du poste et le commit, et il ne peut plus s'inverser (poste vert sur un reçu que la CI refuse). Le défaut est le fichier.
- Le gate et le générateur demandent à git ce qu'il suit. Lancés hors d'un dépôt git (une archive exportée, une copie de `skills/`), ils échouent en le disant. La recette d'empreinte de D1, elle, ne dépend pas de git et se rejoue partout.
- Une copie de skill emporte `metadata.status` et pas le reçu. Dans une copie, le mot est une affirmation ; la preuve est de recalculer l'empreinte et de la comparer au reçu du commit d'origine.
- Aucune promotion n'est possible avant l'enregistrement de D6. Rien ne régresse, puisqu'aucune skill n'est `promoted` ; le premier besoin de promouvoir ouvre ce lot.
- Le reçu n'est pas signé : il est déclaré par le dépôt, et son intégrité est celle de l'historique git et du gate en CI.
- Le chemin du reçu n'est pas dans le bloc d'exclusions d'ADR-0068 D2. Il ne change pourtant qu'avec un chemin exclu (`skills/`, `tools/skills/`, le manifeste) ; modifié seul, il fait échouer le gate.

### Limites connues

Relevées par la revue à rôle séparé de la pull request #274, mesurées le 2026-11-20 sur macOS (APFS). Rien n'est construit pour elles.

- **Casse.** Sur un système de fichiers insensible à la casse, `A.md` et `a.md` sont un seul fichier (mesuré : le second écrit remplace le contenu du premier, une entrée listée). Une skill qui porterait les deux noms, écrite sur Linux, n'aurait donc pas la même empreinte sur un poste macOS, où l'extraction n'en garderait qu'un (inféré de cette mesure, non rejoué avec un dépôt). La recette ne refuse pas deux chemins qui ne diffèrent que par la casse. Aucune skill n'en porte.
- **Composition Unicode.** La recette refuse deux noms qui n'en font qu'un après NFC (D1, point 5). Ce refus ne se produit que sur un système qui garde les deux noms (ext4, le runner de CI) ; APFS les replie en un fichier (mesuré), et le test le tient donc sur des enregistrements, pas sur un répertoire.
- **Fins de ligne.** Le dépôt n'a pas de `.gitattributes`. Un clone fait avec `core.autocrlf=true` extrait les fichiers de skill en CRLF : mesuré, `bun run check:skills-admission` y sort rouge, les huit empreintes diffèrent de celles du reçu et les huit états valent `incomplete` (T1 ne lit plus le frontmatter). L'empreinte porte sur les octets du répertoire, pas sur ceux de l'objet git.
- **Répertoire vide.** Un répertoire vide ajouté ne change pas l'empreinte (D1, point 1) : deux arbres qui ne diffèrent que par lui ont la même.
- **Référence sortante.** Aucune règle ne refuse qu'un fichier de skill cite un chemin hors de son répertoire ; l'empreinte ne couvre pas ce qu'il cite. Aucune skill n'en porte aujourd'hui (constat de la revue, non rejoué ici).

## Alternatives rejetées

| Option | Motif du rejet |
| --- | --- |
| Sortir `metadata.status` du frontmatter : l'état ne vit que dans le reçu | Modifie les huit skills sans échec observé (ADR-0050 D1) et retire le mot qui voyage avec une copie (ADR-0053 D1). Son avantage reste vrai : la promotion porterait sur l'empreinte exacte observée en usage, alors que sous D5 l'écriture de `promoted` change l'empreinte d'une ligne. À rouvrir avec le lot de D6 |
| Laisser un reçu `incomplete` passer au vert, l'état étant distinct du code de sortie | C'est le comportement de l'outil tiers, et son défaut : un agrégat vert avec une skill dont un contrôle requis n'a pas passé |
| Hacher les fichiers suivis par git plutôt que le répertoire | Un fichier non suivi fait partie de ce qu'une copie emporte, T4 lit déjà le répertoire, et la recette doit se rejouer hors d'un dépôt git. Coût accepté : un fichier parasite rougit le gate sur le poste, par son nom (D4, point 6) |
| Laisser un fichier non suivi hors de l'empreinte, avec un compteur qui le dit | Le poste et la CI rendraient le même verdict, mais T4 et une copie du répertoire liraient un fichier que l'empreinte ignore : le reçu dirait « contrôlé » d'un contenu qu'il ne lie pas. Le refus nommé ferme l'écart au lieu de le compter |
| Chercher les clés en double de la liste des contrôles requis par un lecteur JSON dédié | Comparer le texte, espaces à part, à ce qu'un parseur en relit attrape la clé en double à toute profondeur et le nom de clé échappé, sans second parseur à maintenir. Coût accepté : un caractère écrit par son échappement Unicode dans `because`, légitime en JSON, est un défaut ; il s'écrit en clair |
| Ne rien écrire quand un état vaut `incomplete` | Le reçu d'un arbre dont un contrôle échoue est exact ; ne pas l'écrire laisserait sur le disque l'ancien, faux. Le code de sortie porte le verdict (D2) |
| Exclure des noms connus de l'empreinte (`.DS_Store`, caches) | Une liste d'exclusions est une liste d'autorisation à garder de plus ; dans l'outil tiers, la validation des liens précède l'exclusion et un lien nommé comme un cache annule l'empreinte |
| Garder les trois bits d'exécution | L'empreinte dépendrait de l'umask du clone |
| Écrire la liste des contrôles requis dans le code | Retirer un contrôle ne laisserait aucune trace sur la surface gardée |
| Signer le reçu | Aucune clé ni service n'est demandé par ce besoin ; le reçu reste une déclaration du dépôt, dite comme telle |
| Brancher l'outil tiers comme second instrument | Écarté par le drill : il installe à l'exécution un scanner aux dépendances non verrouillées |

## Acte de signature

La fusion de cette pull request par le propriétaire vaut signature (ADR-0043). L'arbitrage du 2026-11-20 portait sur le principe ; ce que la rédaction a tranché seule, et que la fusion signe, est :

1. D5 : `metadata.status` reste dans le frontmatter, tenu égal à l'état dérivé.
2. D3 : les cinq contrôles sont requis, T4 compris, et la liste entre dans `GATED_PATH_PATTERNS`.
3. D6 : aucune promotion n'est possible tant que son enregistrement n'est pas construit, ce qui amende ADR-0050 D3 : une promotion écrite comme D3 la décrit échoue au gate.
4. D2 : le reçu vit sous `ecosystem/projections/` ; le générateur l'écrit même quand il porte `incomplete`, et sort alors en échec.
5. D3, règle 2 : une liste défectueuse vaut à la fois « tout est requis » et un gate rouge ; la clé en double, la clé inconnue et la version de schéma inattendue sont des défauts.
6. D4, point 6 : un fichier de `skills/` que git ne suit pas est un refus nommé, pas un fichier sorti de l'empreinte.
7. `NVIDIA` entre dans `foreignOwners` de `tools/quality/pinned-citations.v1.json`, pour que les citations épinglées de cet ADR soient contrôlées. La pull request #273 (ADR-0071) ajoute la même entrée, avec un autre motif : la seconde à fusionner garde une seule entrée.
8. Registre des décisions : D120.
9. Registre des invariants : aucune entrée. Si le propriétaire veut en inscrire une, texte proposé : « L'état d'admission d'une skill est calculé depuis les contrôles passés sur l'empreinte de son répertoire ; aucun état n'est déclaré à la main, et un contrôle non lancé ne vaut jamais dispense. »

Les points 4 (seconde moitié), 5 et 6 ont été tranchés après la revue à rôle séparé de la révision `e5e0803`, qui a rendu `reject`.

Numérotation. Trois rédactions du même jour numérotent en parallèle. La pull request #273 prend ADR-0071 et les décisions D117, D118 et D119 (relevé le 2026-11-20 par `gh pr diff 273`) ; cet ADR prend 0072 et D120, le premier numéro de décision qu'elle laisse libre. Une première rédaction de cet ADR portait D118, en double avec #273, et écrivait à tort que ce numéro en laissait un libre devant lui ; la revue à rôle séparé l'a relevé.

## Vérification

- `bun run check:skills-admission` : sort 0 et imprime, relevé le 2026-11-20, `entries=10 under skills/ (skills=8 not-a-skill=2 refused=0), skills=8 (fingerprinted=8 without-fingerprint=0), files-hashed=17, untracked=0, required-checks=5 of 5 known, states=8 (candidate=8 incomplete=0), not a skill: ".out-of-scope", "README.md"`. Ces nombres se rejouent, ils ne se citent pas.
- `bun run build:skills-admission && git diff --exit-code ecosystem/projections/skills-admission.v1.json` : aucune différence sur un arbre à jour.
- `bun test tools/skills/skill-fingerprint.test.ts tools/skills/build-skills-admission.test.ts` : la recette contre un vecteur calculé hors du code, l'indépendance à l'umask, le refus nommé d'un lien, d'un FIFO, d'un fichier illisible et de deux chemins confondus après NFC, la dérivation de l'état, chaque contrôle en échec seul, la liste défectueuse (illisible, clé en double, clé inconnue, version de schéma), le fichier non suivi, la collection vide, le gate sur un arbre modifié sans régénération, le code de sortie du générateur, le déterminisme, et les sommes des compteurs sur l'arbre réel. Les tests cherchent un constat par ce qu'il nomme et un volume par ses compteurs, pas par le texte entier d'une ligne.
- La troisième commande de la section « Vérification empirique » rejoue une empreinte sans ce code.
