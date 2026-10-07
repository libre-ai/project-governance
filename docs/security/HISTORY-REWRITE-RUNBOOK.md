# Runbook — retirer un identifiant fuité de l'historique d'un dépôt public

> **Provenance.** Extrait d'un dépôt privé de configuration machine avant sa
> suppression, le 2026-07-26. Le runbook a été **répété à blanc** sur un miroir
> réel puis révisé après une revue adversariale qui a corrigé son périmètre.
> Les motifs de remplacement propres à l'incident d'origine ont été retirés :
> ils désignaient un contexte étanche non public, et ce document n'a pas
> vocation à en conserver la trace.

Un identifiant privé (adresse de contact, nom d'organisation, secret) a été
publié dans un dépôt public. Le corriger sur `HEAD` ne suffit pas : il reste
dans l'historique, dans les références de demandes de fusion, et dans les
caches de la forge. Ce runbook décrit l'opération complète, ses préalables, ses
critères d'acceptation et son rollback.

**Cette opération est destructive et irréversible côté distant. Elle est
exécutée par le propriétaire du dépôt, jamais déléguée à un agent.**

## Étape 0 — Corriger `HEAD` d'abord, séparément

La réécriture d'historique est une opération lourde qui demande une fenêtre
sans travail en vol. Elle ne doit pas retarder la correction visible :

1. Retirer l'identifiant du `HEAD` de la branche par défaut, dans une demande
   de fusion normale, en le remplaçant par un **placeholder en domaine
   réservé** (`example.com`, `.example`, `.invalid`) — jamais par un autre
   identifiant réel.
2. Poser dans la même passe un **détecteur bloquant en CI**, prouvé dans les
   deux sens : rouge sur une fixture qui contient délibérément le motif, vert
   sur l'arbre réel. Un détecteur jamais vu rouge n'est pas un détecteur.
3. Ensuite seulement, planifier la réécriture.

Cette séquence borne l'exposition en heures au lieu de jours, et garantit
qu'aucun nouveau commit ne réintroduira le motif pendant la préparation.

## Étape 1 — Établir les préalables

| Préalable                                                | Pourquoi                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Aucune demande de fusion ouverte                         | elles seraient réécrites ou invalidées, et leurs références sont immuables          |
| Branches distantes non fusionnées : fusionnées ou gelées | le miroir les traite dans la même passe ; un rebase manuel après coup est ingérable |
| Fenêtre sans travail en vol                              | tout clone de travail devient obsolète à la seconde du force-push                   |
| Inventaire des clones et arbres de travail locaux        | ils deviennent orphelins ; il faut savoir lesquels re-créer                         |

## Étape 2 — Borner le périmètre du remplacement (la révision qui compte)

**Ne réécrivez que ce qui doit l'être.** Le périmètre initial de l'opération
d'origine incluait à la fois les identifiants privés _et_ les chemins
machine-locaux. La revue adversariale l'a réduit aux seuls identifiants
privés, pour une raison mécanique :

Des rapports d'évidence scellés étaient épinglés par **empreinte SHA-256** dans
un script de contrôle exécuté par un job requis. Ces rapports contenaient les
chemins machine-locaux. Les réécrire aurait changé leur empreinte et mis la
branche par défaut en rouge de façon certaine.

Vérification menée avant de trancher : le script de contrôle compare les
identifiants scellés **comme des chaînes dans le texte des documents**, sans
résolution git. Une réécriture limitée aux identifiants laisse donc l'arbre
courant octet pour octet identique, et le contrôle reste vert.

**Conséquence acceptée et documentée** : les identifiants de commits cités dans
les documents scellés référenceront un historique disparu. Ils constituent un
registre historique, et aucune vérification automatique ne les résout.

Règle générale : **avant de réécrire, chercher tout ce qui épingle une
empreinte ou un identifiant de commit** (contrôles de qualité, manifestes,
attestations, verrous de dépendances). Chaque épinglage est soit hors du
périmètre de réécriture, soit à mettre à jour dans la même opération.

## Étape 3 — Exécuter sur un miroir frais

```bash
# 0. PRÉALABLE vérifié : aucune demande de fusion ouverte, fenêtre libre.

# 1. Purger tout miroir précédent, puis régénérer à l'état FINAL de la branche.
rm -rf ../rewrite-mirror.git
git clone --mirror <url-du-depot> ../rewrite-mirror.git
cd ../rewrite-mirror.git

# 2. Mémoriser l'arbre AVANT, pour prouver plus tard qu'il n'a pas bougé.
pre_tree="$(git rev-parse main^{tree})"

# 3. Décrire les remplacements, un par ligne, insensibles à la casse.
#    Le remplacement pointe TOUJOURS vers un domaine réservé, jamais réel.
printf '%s\n' \
  'regex:(?i)<motif-a-retirer>==><remplacement-neutre>' > ../replacements.txt

# 4. Réécrire.
uvx git-filter-repo --replace-text ../replacements.txt

# 5. VÉRIFIER AVANT TOUT PUSH.
test "$(git rev-parse main^{tree})" = "$pre_tree" && echo "arbre HEAD intact"
git log -S '<motif>' --all --oneline | wc -l    # 0 attendu, PAR VARIANTE DE CASSE
```

Trois pièges vérifiés à ce stade :

- **L'outil de réécriture supprime le remote `origin`** après l'opération.
  C'est une protection délibérée contre un push réflexe : il faut le ré-ajouter
  explicitement, ce qui force à relire la commande de push.
- **Si du temps a passé entre la génération du miroir et le push**, vérifier que
  l'arbre distant est toujours celui du miroir
  (`git rev-parse origin/main^{tree}` contre `main^{tree}`) : un commit arrivé
  entre-temps serait écrasé.
- **`git log -S` doit être rejoué par variante de casse.** Un motif présent en
  casse mixte survit à une passe sensible à la casse.

## Étape 4 — Pousser, dans une fenêtre d'autorisation minimale

Le force-push sur la branche par défaut est normalement interdit par la
protection de branche — vérifié : sans levée, le push est rejeté.

1. Autoriser **temporairement** le force-push dans les réglages de protection
   de branche.
2. Ré-ajouter le remote, puis pousser toutes les références :

   ```bash
   git remote add origin <url-du-depot>
   git push --force origin 'refs/heads/*' 'refs/tags/*'
   ```

   Les **étiquettes doivent être poussées explicitement** : une passe limitée
   aux têtes de branches laisse le motif vivant dans les objets référencés par
   les étiquettes.

3. **Rétablir l'interdiction immédiatement après.**

Une garde locale de push peut également refuser tout force-push : c'est
volontaire. L'opération est faite à la main par le propriétaire, en connaissance
de cause, pas contournée par un agent.

## Étape 5 — Traiter les résidus côté forge et côté postes

| Résidu                                           | Traitement                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Références de demandes de fusion (`refs/pull/*`) | **immuables côté client** — purge uniquement par ticket au support de la forge |
| Caches de la forge                               | même ticket                                                                    |
| Clones de travail et arbres de travail           | tous obsolètes : re-cloner, re-créer seulement ce qui sert                     |
| Miroir de réécriture et clone pré-réécriture     | supprimés **après validation complète**, jamais avant                          |

Le point le plus souvent manqué : **les références de demandes de fusion
survivent à la réécriture** et restent servies par la forge. Sans le ticket au
support, le motif reste accessible par URL directe alors que `git log` est
propre.

## Acceptation et rollback

**Acceptation** — les trois conditions, toutes vérifiées sur un **re-clone
frais**, jamais sur le miroir qui a servi à l'opération :

1. l'arbre de la branche par défaut est identique avant et après (`pre_tree`) ;
2. `git log -S <motif> --all` retourne 0, pour chaque motif et chaque variante
   de casse ;
3. la CI est verte sur la branche réécrite.

**Rollback** — conserver le clone de travail pré-réécriture jusqu'à validation
complète. Le retour arrière consiste à re-pousser l'ancien état ; c'est une
décision du propriétaire, et elle réexpose l'identifiant.

## Pièges d'outillage à ne pas reproduire

Ces pièges ont produit de fausses assurances lors de la préparation. Ils sont
listés parce qu'ils portent tous le même risque : **conclure « aucune
contamination » à partir d'une commande qui n'a rien cherché.**

- **`grep -P` n'existe pas sur BSD/macOS.** Il échoue en affichant son usage —
  ce qui se lit comme « aucun résultat ». `git grep -P` fonctionne (git embarque
  son propre moteur).
- **Le moteur ERE de `git grep` ignore `\b` sans le signaler.** `git grep -E
'\bmot\b'` peut retourner 0 là où `git grep -P '\bmot\b'` retourne des
  dizaines de résultats.
- **Un motif contenant une séquence d'échappement littérale ne matche pas ce
  qu'on croit.** Un texte contenant `nom\.prenom` (avec une contre-oblique
  réelle) n'est trouvé ni par `-F 'nom.prenom'` ni par `-P 'nom\.prenom'`.
  Chercher par **jetons courts et séparés** plutôt que par chaînes composées.
- **Une commande inexistante affiche son aide**, et `wc -l` compte alors ses
  lignes d'usage comme des résultats.
- **`head` tronque sans le dire** : ne jamais conclure qu'un fichier est propre
  depuis une lecture tronquée.
- **`git grep` ne voit que les fichiers suivis.** Les fichiers non suivis
  échappent au contrôle.

**Contrôle positif obligatoire.** Avant de faire confiance à un scan, le
prouver sur un cas qui _doit_ matcher. Un scan qui n'a jamais été vu rouge ne
prouve rien.
