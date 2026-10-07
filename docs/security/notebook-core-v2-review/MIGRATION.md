# Note de migration — v1 vers v2

## Décision

**Oui, la correction impose `notebook-core@2.0.0` et `libre-ai.notebook-backup.v2`.** `contracts/COMPATIBILITY.md` classe le WIT comme frontière exacte major-versionnée et `notebook-core-v1` est verrouillé dans le catalogue.

Les ruptures sont substantielles :

- le monde WIT exporte une interface autonome `api` afin que le composant n'importe aucune interface de types ;
- `seal-backup` reçoit désormais une requête typée avec identifiant opaque CSPRNG, version, cipher et KDF ;
- `createdAt` est retiré de l'enveloppe claire ; un horodatage produit éventuel appartient au plaintext chiffré ;
- `open-backup` renvoie le plaintext avec l'identifiant et le digest effectivement authentifiés ;
- les erreurs string libres deviennent un enum fermé ;
- le recovery secret v2 devient exactement 16 octets CSPRNG via l'unique profil `code.v1` ; toute saisie libre/textuelle exigera un futur major ;
- Context v2 remappe les IDs de blocs par export et retire révisions/exclusions du payload partagé ;
- l'enveloppe ajoute la version Argon2 et la longueur de sortie, renomme `ciphertextDigest` en `digest` et en fixe une nouvelle sémantique ;
- AAD, JCS, Base64, tailles, tag, digest et comportement anti-oracle deviennent normatifs ;
- les bornes KDF v1 (`memoryKiB` jusqu'à 1 GiB, `iterations` jusqu'à 20, `parallelism` jusqu'à 16) ne sont pas compatibles avec le budget local v2.

Une enveloppe v1 ne doit jamais être interprétée comme v2, et un producteur v2 ne doit jamais émettre `schemaVersion = "libre-ai.notebook-backup.v1"`.

## Données existantes

Aucun moteur n'étant encore implémenté, il ne devrait exister aucune sauvegarde v1 faisant autorité : la migration attendue est une migration de contrat, pas de données.

Si des prototypes ont néanmoins émis des fichiers v1, aucune adaptation automatique sûre n'est définissable : v1 ne fixe ni AAD, ni digest, ni génération de l'`id`. Le propriétaire doit ouvrir le prototype avec sa version exacte, hors du nouveau cœur, puis resceller le plaintext en v2 avec un nouveau sel et un nouveau nonce. Un fichier v1 seul, sans implémentation historique précisément identifiée, est non migrable. Le cœur v2 ne tente jamais plusieurs recettes cryptographiques et ne fournit pas d'oracle de détection.

## Progression après Gate S

La Gate S consignée dans [`SOLO-CHALLENGE.md`](SOLO-CHALLENGE.md) autorise la rédaction et les contrôles machine du candidat.

L'autorisation de démarrage du **moteur expérimental** n'est acquise qu'après Gate A et décision propriétaire.
La Gate B reste ensuite obligatoire avant toute sauvegarde utilisateur et release.

## Promotion après Gate A

Après quatre verdicts agentiques Gate A favorables et l’autorisation de merge du propriétaire consignés dans [`INDEPENDENT-REVIEW.md`](INDEPENDENT-REVIEW.md), une promotion atomique doit :

1. vérifier que les copies cataloguées sous `contracts/` sont byte-identiques aux candidats examinés ;
2. lier les autorités aux commits et preuves exacts de Gate A ;
3. promouvoir explicitement les statuts `candidate` concernés vers `locked` ;
4. lever le blocage d’implémentation expérimentale du work package, sans autoriser de sauvegarde utilisateur ;
5. conserver v1 comme autorité historique dépréciée, sans producteur, jusqu'à preuve qu'aucune donnée v1 n'existe ;
6. préparer la Gate B attribuable sur le composant construit.

La promotion n'autorise pas encore une release en conditions utilisateur. Avant Gate A, aucune implémentation n’est autorisée ; après Gate A et avant Gate B, le moteur peut tourner dans un périmètre expérimental de vérification ; avant Gate B, aucune sauvegarde utilisateur n’est émise.
