# Auditer la licence d'une dépendance transitive — méthode et exception bornée

> **Provenance.** Extrait d'un dépôt privé d'expérimentation avant sa
> suppression, le 2026-07-26. Revue menée le 20 juillet 2026, décision de
> politique le 21 juillet 2026. Les empreintes de l'artefact concerné ont été
> conservées comme illustration de la méthode d'épinglage.
>
> **Cette note ne constitue pas un avis juridique.**

Un audit de licences automatisé classe généralement les dépendances en
« autorisée / interdite ». Le cas difficile n'est ni l'une ni l'autre : une
dépendance **transitive, profonde, réellement utilisée**, sous une licence qui
n'est ni copyleft interdit ni permissive standard. Cette méthode traite ce cas
sans le contourner.

## Étape 1 — Établir le périmètre exact, pas approximatif

Deux questions, dans cet ordre :

**La dépendance est-elle réellement dans le graphe de production ?** Se
prononcer sur la chaîne complète, telle qu'elle apparaît dans le lockfile :

```text
<paquet-racine>@0.12.0
└─ ssh2@1.17.0
   └─ bcrypt-pbkdf@1.0.2
      └─ tweetnacl@0.14.5
```

**Le code est-il réellement appelé ?** C'est le point que les audits sautent.
Ici, `bcrypt-pbkdf` importe `tweetnacl.lowlevel.crypto_hash` : ce n'est donc
**pas une métadonnée inutilisée**, et l'argument « la licence ne s'applique pas
puisqu'on ne l'exécute pas » tombe. Vérifier l'appel, ne pas le supposer.

## Étape 2 — Épingler l'artefact par empreinte, pas par version

Une version n'identifie pas un artefact : elle peut être republiée, et la
licence lue peut différer de la licence déclarée dans les métadonnées. Épingler
ce qui a été **réellement inspecté** :

- intégrité du tarball telle qu'inscrite au lockfile ;
- SHA-256 du fichier `LICENSE` installé ;
- SHA-256 du `package.json` installé ;
- SHA-256 du **fichier runtime effectivement chargé**.

À titre d'illustration, les empreintes retenues dans le cas d'espèce :

```text
LICENSE       88d9b4eb60579c191ec391ca04c16130572d7eedc4a86daa58bf28c6e14c9bcd
package.json  4d4e7122e483ab7bed48c884bb0de1471d3cb3753e1a334e3aafa3c32c22923e
nacl-fast.js  432333a18cef679d16c71328fcc18cc547e58d7d1c2b880a581b2d7ee4248027
```

**L'audit repasse en échec au moindre changement de version, d'intégrité ou
d'empreinte.** C'est ce qui transforme une exception ponctuelle en garde-fou :
l'exception ne survit pas à une mise à jour silencieuse.

## Étape 3 — Lire le texte installé, pas l'étiquette SPDX

L'identifiant SPDX déclaré est une indication. Ce qui engage, c'est le texte
livré dans l'artefact. Points à qualifier explicitement :

| Question                                                                       | Constat dans le cas d'espèce  |
| ------------------------------------------------------------------------------ | ----------------------------- |
| Dédicace au domaine public quand la juridiction le permet ?                    | oui                           |
| Copie, modification, usage commercial, distribution ?                          | autorisés                     |
| Obligation de publication du source ou réciprocité réseau ?                    | aucune                        |
| Garanties et responsabilité ?                                                  | exclues                       |
| **Concession de brevets explicite ?**                                          | **absente**                   |
| **Licence permissive de repli** si la dédicace n'est pas pleinement reconnue ? | **absente dans cet artefact** |

Diagnostic : ce n'est ni AGPL, ni SSPL, ni BSL. **Le risque n'est donc pas un
copyleft interdit** — c'est l'incertitude juridique de la dédicace au domaine
public selon les juridictions (notamment autour de droits qui ne sont pas
intégralement renonçables), plus l'absence de concession de brevets.

Nommer le risque réel évite deux erreurs symétriques : bloquer une dépendance
inoffensive parce que son étiquette est inhabituelle, ou l'accepter sans voir
que l'incertitude porte ailleurs que sur le copyleft.

## Étape 4 — Qualifier la souveraineté séparément de la licence

- aucun appel réseau identifié dans la bibliothèque ; exécution locale ;
- la licence n'impose ni service tiers, ni transfert de données, ni télémétrie ;
- l'artefact a été obtenu depuis un registre public pendant une installation
  explicitement autorisée ; aucune donnée du projet n'a été transmise ;
- pour un usage distribué, **conserver l'avis de licence dans les notices même
  en l'absence d'obligation d'attribution**, par traçabilité.

## Étape 5 — Formuler des options, puis trancher explicitement

Trois options, avec leur coût réel :

1. **Exception limitée** — accepter cette version précise, à ces empreintes,
   pour ce paquet parent seulement.
2. **Remplacement amont** — supprimer la chaîne de dépendances ou obtenir une
   variante sous licence autorisée. Exige un changement amont et une nouvelle
   évaluation.
3. **Rester en laboratoire** — conserver l'acceptation sans distribution ni
   activation globale.

**Le vendoring local ne résout pas l'incertitude de licence** et n'est pas un
contournement recommandé : recopier le code ne change rien aux droits concédés.

### La décision, et ce qu'elle n'accorde pas

L'option 1 a été retenue, avec un périmètre écrit en négatif — c'est la partie
qui compte :

- elle **n'approuve aucune autre version** ni aucune autre dépendance sous la
  même licence ;
- elle **doit être réévaluée** si une version, une empreinte ou la chaîne de
  dépendances change ;
- elle **conserve l'avis de licence** par traçabilité ;
- elle **n'infère aucune concession de brevets** ;
- elle **accepte explicitement** l'incertitude juridictionnelle décrite.

## Étape 6 — Rendre la décision exécutable

Une décision de licence qui ne vit que dans un document dérive dès la première
mise à jour de dépendances. Elle doit être :

- **lisible par machine** — un fichier structuré déclarant paquet, version,
  empreintes et périmètre de l'exception ;
- **rejouable hors réseau** — l'audit tourne sans accès au registre, depuis les
  artefacts déjà installés ;
- **bloquante** — l'audit échoue si une version ou une licence non acceptée
  apparaît.

Résultats obtenus sur les deux graphes audités : sur le premier, 15 paquets,
dont trois aux métadonnées absentes vérifiées manuellement dans les tarballs
exacts, une option de licence multiple jugée compatible, aucun copyleft
interdit, et la seule exception épinglée ci-dessus. Sur le second, 8 paquets,
tous sous licence permissive, audit automatisé vert.

**Ce que l'audit ne fait pas** : il ne corrige aucun écart d'isolation ou de
sécurité du paquet concerné. Un graphe de licences vert n'a jamais rien dit du
comportement du code.
