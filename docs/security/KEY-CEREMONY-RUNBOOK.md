# Cérémonial de génération de clé Ed25519 — Runbook propriétaire

**Jalon :** WP-G2-Z01 · **Date :** 2026-07-22 · **Objet :** Upgrade vers signature d'origine Ed25519 (asymétrique) pour les briques de provenance et preuve (couche 3).

> **Déclencheur (arbitrage propriétaire 2026-08-18).** Cette cérémonie s'exécute au
> prononcé de l'orchestrator lock — c'est lui le premier consommateur réel de
> lignage signé. Dormant jusque-là : K3 (`LOOP-SECURITY-KERNEL.md`) sert
> aujourd'hui en HMAC sur l'intégralité des chemins de rappel model-facing, et
> l'upgrade Ed25519 documentée ci-dessous reste différée sans dégrader cette
> garantie. Ne pas exécuter la cérémonie par anticipation du lock.

Ce runbook vous guide pas-à-pas pour générer, sceller et enregistrer une clé privée Ed25519 qui signera les enveloppes de lignage d'agents (`AgentContributorLineage v1`, bouille de preuve). **La clé privée ne doit JAMAIS quitter votre machine air-gappée ni être committée dans git.** Seule la clé publique est enregistrée dans le dépôt.

## Prérequis de sécurité

### Machine air-gappée (isolée réseau)

1. **Préparation matérielle :**
   - Machine dédiée (ou conteneur sécurisé), sans accès Wi-Fi, Bluetooth, Ethernet.
   - Désactiver tous les services réseau, USB masquerading, et appareils périphériques non essentiels.
   - Vérifier l'absence de caméra ou de microphone intégré (ou les masquer physiquement).
   - Boot sur un système live (USB amorçable Linux, ex. Tails ou une distribution light) ou une VM isolée avec snapshot net préalable au travail.

2. **Vérification d'isolation :**

   ```bash
   # Vérifier qu'aucune interface réseau n'est active
   ip link show
   # Doit afficher : "NO-CARRIER" ou aucune interface réseau (sauf loopback)

   # Vérifier qu'aucun processus n'émet vers l'extérieur
   netstat -tlnp 2>/dev/null | grep -E ':(22|443|80|53)' || echo "OK: no network listeners"
   ```

3. **Matériel de sauvegarde :**
   - USB dédié, vierge, formaté en FAT32 (compatible multi-plateforme, pas de métadonnées Unix).
   - Papier pour inscrire le mot de passe maître (voir Étape 5, sealing).
   - Optionnel : HSM (Hardware Security Module, ex. Ledger, Yubikey) si vous disponez pour chiffrer la clé scellée.

---

## Étapes de la cérémonial

### Étape 1 : Préparer le clone du dépôt

1. Sur votre machine air-gappée, clonez le dépôt de gouvernance en lecture seule (pas de SSH, pas de prise d'authentification). C'est lui qui porte l'outil et le registre `config/signing-keys.v1.json`.

   ```bash
   # Clone préparé avant la coupure réseau, puis copié par USB (ou rsync local)
   git clone --depth 1 https://github.com/libre-ai/project-governance.git project-governance
   cd project-governance
   ```

   Le support de sortie (`--out`) ne doit pas se trouver dans ce clone ni dans aucun dépôt git : l'outil remonte les parents du répertoire de sortie et refuse (code 4) s'il y trouve une entrée `.git`.

2. Vérifiez la présence du script `tools/security/keygen-ceremony.ts` et du Bun épinglé (voir Dépannage, « Quel runtime pour la cérémonie ? »).
   ```bash
   ls tools/security/keygen-ceremony.ts
   bun --revision   # doit être égal à : jq -r .revision toolchains/bun.json
   ```

### Étape 2 : Vérifier l'isolation réseau avant chaque étape

Avant de lancer le script de génération, vérifiez que la machine est toujours isolée :

```bash
netstat -an 2>/dev/null | grep -E 'ESTABLISHED|LISTEN' && echo "ERREUR: connexions réseau détectées" || echo "OK: isolée"
```

### Étape 3 : Générer la paire de clés Ed25519

L'outil génère une paire Ed25519, dérive l'identifiant de clé, lit la phrase de passe, scelle la clé privée et écrit deux fichiers dans le répertoire `--out`, qui est obligatoire. Lancez-le depuis la racine du clone, avec `--out` sur le support amovible :

```bash
entry="$(bun tools/security/keygen-ceremony.ts --out /mnt/usb/offline-keys)" \
  && printf '%s\n' "$entry" > /mnt/usb/offline-keys/registry-entry.json
```

La sortie standard est capturée dans une variable et n'est écrite qu'en cas de succès : une redirection directe (`> …/registry-entry.json`) créerait ce fichier, vide, dans `--out` même quand l'outil refuse. Les invites de saisie passent par le terminal, pas par la sortie standard : la capture ne les masque pas.

Options de l'entrée de registre, toutes facultatives :

- `--purpose <texte>` : l'usage de la clé, 1 à 256 caractères ; il décrit la clé, jamais une personne. Défaut : `AgentContributorLineage v1, Proof v1 origin signatures`.
- `--artifact-types <type,…>` : les types de manifeste d'artefact que la clé peut signer, parmi `build`, `dataset`, `export`, `release`, `evidence`, séparés par des virgules, sans répétition, 5 au plus. Défaut : aucun. Une clé sans type est admise au registre mais n'autorise aucun manifeste (règle S7 du contrat) : c'est le cas des clés de lignage et de preuve.
- `--signatory <rôle>` : l'identifiant de rôle du témoin (`^[a-z][a-z0-9-]{0,63}$`). Défaut : `key-custodian`. Un nom ou une adresse est refusé en usage (code 2, la valeur n'est pas recopiée) : l'identité de la personne vit dans le trailer `Signed-off-by` du commit qui enregistre la clé (règle K7), jamais dans le registre.

**Refus attendus de l'outil (code 4, rien d'écrit) :**

- une variable de CI posée (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `TRAVIS`, `BUILDKITE`) ;
- un répertoire `--out` situé dans un dépôt git (entrée `.git` dans lui ou l'un de ses parents) ;
- un fichier `<identifiant>.sealed`, `<identifiant>.pub.pem` ou `<identifiant>.partial` déjà présent dans `--out` ;
- une phrase de passe de moins de 32 caractères, ou deux saisies différentes.

Un `<identifiant>.partial` ne subsiste qu'après une interruption brutale (coupure de courant, arrêt forcé) entre l'écriture de l'enveloppe et son contrôle : l'outil le supprime lui-même sur tout échec qu'il traite. Ce fichier n'a pas été vérifié : supprimez-le. Il ne bloque pas une nouvelle cérémonie, dont la clé et donc le nom sont neufs ; le refus ne vise que la même clé, rejouée.

Une phrase de passe en argument (`--passphrase …`) est refusée en usage (code 2) : elle serait visible dans la liste des processus et l'historique du shell.

### Étape 4 : Examiner les sorties de l'outil

Les messages pour l'opérateur vont sur la sortie d'erreur. La sortie standard ne porte que l'entrée de registre, en JSON, capturée ci-dessus puis écrite dans `registry-entry.json` :

```json
{
  "signingKeyId": "ed25519-<64 caractères hexadécimaux>",
  "algorithm": "Ed25519",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "purpose": "AgentContributorLineage v1, Proof v1 origin signatures",
  "artifactTypes": [],
  "activatedAt": "<instant de la cérémonie, AAAA-MM-JJTHH:MM:SS.sssZ>",
  "revokedAt": null,
  "witness": {
    "signatory": "key-custodian",
    "attestedAt": "<même instant>",
    "comment": "Offline key ceremony; the sealed envelope was unsealed and checked against this public key before it was named."
  }
}
```

C'est une clé du contrat `signing-keys.v1` du dépôt des contrats (`contracts/schemas/signing-keys.v1.schema.json`, sémantique et règles K0 à K7 dans `contracts/artifact-manifest-signatures-v1/SEMANTICS.md`). Le test de l'outil valide l'entrée imprimée contre une copie octet pour octet de ce schéma (`tools/security/fixtures/signing-keys-v1/`, dont `origin.json` nomme le commit lu).

L'identifiant `signingKeyId` est `ed25519-` suivi du SHA-256, en hexadécimal minuscule, des 32 octets bruts de la clé publique (règle K3). Il ne dépend ni de la date ni de l'encodage PEM : tout vérificateur le recalcule depuis la clé. Il nomme aussi les deux fichiers écrits dans `--out`.

`revokedAt` vaut `null` pour une clé en vigueur et ne s'omet pas. `witness.attestedAt` reçoit l'instant de la cérémonie ; si le témoin atteste plus tard, à la revue de l'enregistrement, mettez-y l'instant de son attestation.

Fichiers écrits dans `--out`, dans cet ordre :

1. `<identifiant>.sealed`, créé avec le mode 0600 (sur un système de fichiers qui conserve les permissions Unix ; FAT32 ne les conserve pas et affiche celles des options de montage, la confidentialité de l'enveloppe y repose sur son scellement et sur la garde physique du support) : l'enveloppe scellée. L'outil l'écrit d'abord sous un nom temporaire, la relit, la descelle en mémoire et compare la clé publique qu'elle contient à celle générée ; il ne lui donne son nom final qu'après ce contrôle.
2. `<identifiant>.pub.pem` : la clé publique, écrite seulement après l'enveloppe.

Un échec à n'importe quelle étape supprime ce que l'outil a écrit et sort en code 1, sans fichier public.

### Étape 5 : Saisir la phrase de passe maître

L'enveloppe est scellée par scrypt (N=16384, r=8, p=1) puis AES-256-GCM, sous la phrase de passe maître que vous saisissez pendant l'étape 3.

#### Format de l'enveloppe

Version `0x01`, la seule que l'outil écrit :

```
version (1 octet, 0x01) || sel (16) || nonce (12) || chiffré || étiquette (16)
```

- clé de 32 octets dérivée par scrypt (N=16384, r=8, p=1) de la phrase de passe et du sel ;
- AES-256-GCM, nonce aléatoire de 12 octets tiré à chaque scellement, étiquette de 16 octets ;
- les 29 octets d'en-tête (version, sel, nonce) sont authentifiés comme données associées ;
- le clair est la clé privée Ed25519 en PEM PKCS#8 (119 octets) : une enveloppe fait 164 octets.

À la lecture (`--verify-sealed`, et le contrôle que fait l'outil avant de nommer l'enveloppe), un refus porte un code nommé sur la sortie d'erreur, toujours en code de sortie 1 :

| Code | Cause |
| --- | --- |
| `SEAL_UNKNOWN_VERSION` | premier octet autre que `0x01` |
| `SEAL_AUTH_FAILED` | mauvaise phrase de passe, ou octet altéré (en-tête, chiffré ou étiquette) |
| `SEAL_TOO_SHORT` | fichier plus court que l'en-tête et l'étiquette |
| `SEAL_LEGACY_CIPHER_UNAVAILABLE` | ancienne enveloppe, chiffrement indisponible dans ce runtime (voir Dépannage) |

**Ancienne enveloppe.** La première version de l'outil écrivait `sel (16) || nonce (12) || chiffré || étiquette (16)` en ChaCha20-Poly1305, sans octet de version. Elle se reconnaît à sa longueur, 163 octets (le même PEM de 119 octets, sans l'octet de version). L'outil n'en produit plus ; il la lit encore là où le runtime fournit `chacha20-poly1305`, et la refuse ailleurs avec `SEAL_LEGACY_CIPHER_UNAVAILABLE`.

1. **Choisir une phrase de passe maître** (minimum 32 caractères, mélange alphanumériques + symboles) :

   ```bash
   # Exemple (à adapter, NE PAS copier) :
   # "Librarie-42!Chiffre~Mur|Soleil(Zèbre)2026"
   ```

2. **La saisir au terminal :** l'outil la demande deux fois sur le terminal de contrôle, sans écho. Elle ne passe jamais en argument ni dans l'environnement. Pour un usage scripté, `--passphrase-fd <n>` la lit sur un descripteur hérité (par exemple `3< fichier-sur-support-chiffré`) ; c'est aussi ce que font les tests.

3. **Sauvegarder la phrase de passe** :
   - **Sur papier chiffré :** Écrivez la phrase de passe sur du papier, enfermez-la dans une enveloppe cachée (ex. coffre-fort domestique, zone sécurisée).
   - **Divisé (Shamir) :** Optionnel, distribuez 3 parts de la phrase de passe à 3 personnes de confiance, exigez 2 signatures pour reconstituer (scheme 3-de-5).
   - **Jamais en clair électroniquement,** jamais en plaintext sur le disque.

### Étape 6 : Vérifier le scellé avant de quitter la machine hors ligne

L'outil a déjà descellé l'enveloppe une fois avant de la nommer. Refaites la vérification vous-même, sur le fichier tel qu'il est sur le support, avant de quitter la machine hors ligne :

```bash
bun tools/security/keygen-ceremony.ts \
  --verify-sealed /mnt/usb/offline-keys/<identifiant>.sealed \
  --public-key /mnt/usb/offline-keys/<identifiant>.pub.pem
```

L'outil redemande la phrase de passe (une fois, sans écho), descelle en mémoire et compare la clé publique dérivée au fichier `--public-key`. Code 0 : l'enveloppe contient bien cette clé et la phrase de passe est la bonne. Code 1 : mauvaise phrase de passe, enveloppe altérée ou clé différente ; ne quittez pas la machine, recommencez la cérémonie. La clé privée n'est jamais affichée.

### Étape 7 : Sauvegarder hors-ligne et vérifier l'intégrité

1. **Le fichier scellé est déjà sur le support** (`--out`) : aucune copie depuis un répertoire temporaire.

2. **Vérifier l'intégrité (checksum SHA-256) :**

   ```bash
   cd /mnt/usb/offline-keys
   sha256sum <identifiant>.sealed > <identifiant>.sealed.sha256
   # Plus tard (après éjection/réinsertion) :
   sha256sum -c <identifiant>.sealed.sha256
   ```

3. **Le support porte aussi :**
   - `<identifiant>.pub.pem` (pour reconstruction post-disaster) ;
   - `registry-entry.json`, l'entrée à recopier dans le registre.

4. **Éjecter l'USB et stocker hors-ligne :**
   ```bash
   umount /mnt/usb
   # Rangez l'USB dans un coffre-fort, une zone sécurisée, avec duplication géographique si needed.
   ```

### Étape 8 : Enregistrer la clé publique dans le dépôt

Retour sur votre machine de développement (connectée, post-cérémonial). L'outil n'écrit jamais ce registre : recopiez l'entrée de `registry-entry.json`, telle quelle, dans `keys`. Elle porte déjà le témoin, sous un identifiant de rôle.

1. **Créer le fichier de manifest des clés publiques** (ou le mettre à jour) :

   ```
   config/signing-keys.v1.json
   ```

2. **Format du manifest (JSON)** :

   ```json
   {
     "schemaVersion": "libre-ai.signing-keys.v1",
     "keys": [
       {
         "signingKeyId": "ed25519-<SHA-256 hex des 32 octets bruts de la clé publique>",
         "algorithm": "Ed25519",
         "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
         "purpose": "AgentContributorLineage v1, Proof v1 origin signatures",
         "artifactTypes": [],
         "activatedAt": "2026-07-22T10:00:00.000Z",
         "revokedAt": null,
         "witness": {
           "signatory": "key-custodian",
           "attestedAt": "2026-07-22T12:00:00.000Z",
           "comment": "Initial key ceremony, air-gapped generation"
         }
       }
     ]
   }
   ```

   Aucun membre ne porte de donnée personnelle (règle K7) : `signatory` est un rôle (`key-custodian`, `security-reviewer`…), jamais un nom ni une adresse ; `purpose` et `comment` décrivent la clé. L'identité de qui enregistre et atteste est celle du trailer `Signed-off-by` du commit ci-dessous. Le contrat refuse en bloc un registre qui enfreint une règle K (`key-set-invalid`) : 1 à 64 clés, aucun membre inconnu, deux entrées jamais sous le même `signingKeyId` (K4).

3. **Valider le format :** le registre se valide contre `contracts/schemas/signing-keys.v1.schema.json` du dépôt des contrats. Aucun contrôle de ce dépôt ne lit encore `config/signing-keys.v1.json` (`bun run check:source` ne le lit pas). Avant le commit, recalculez au moins chaque identifiant (règle K3, commande de la section Dépannage) et vérifiez qu'aucun ne se répète (K4) :

   ```bash
   jq -r '.keys[].signingKeyId' config/signing-keys.v1.json | sort | uniq -d   # doit ne rien afficher
   ```

4. **Committer avec DCO signoff :**
   ```bash
   git add config/signing-keys.v1.json
   git commit -s -m "feat(security): register initial Ed25519 signing key (WP-G2-Z01)

   - signingKeyId: <identifiant>
   - Algorithm: Ed25519
   - Purpose: origin signature for AgentContributorLineage v1
   - Generated via air-gapped key ceremony 2026-07-22

   WP-G2-Z01"
   ```

---

## Protocole de rotation (retrait ordinaire)

Le contrat `signing-keys.v1` distingue deux fins de vie (SEMANTICS.md, « Key lifecycle ») : la **rotation retire l'entrée** du registre ; `revokedAt` est **réservé à la compromission** (section suivante). Une clé tournée n'est jamais marquée `revokedAt`.

### Quand faire tourner une clé ?

- **Rotation programmée :** tous les 2 ans (hygiène cryptographique).
- **Changement de gardien ou fin d'usage :** la clé n'a plus de détenteur ou plus d'objet.
- **Algorithme périmé :** si la recherche cryptographique découvre une faiblesse en Ed25519.

Une clé possiblement exposée (machine compromise, accès non autorisé au support) ne tourne pas : elle se **révoque** (section suivante).

### Processus de rotation

1. **Générer une nouvelle paire** en reprenant la cérémonie complète (étapes 1 à 8) ; la nouvelle entrée entre au registre à côté de l'ancienne.
2. **Re-signer avec la nouvelle clé**, avant tout retrait, chaque manifeste qui doit continuer à se vérifier : pendant le recouvrement, l'enregistrement de signatures porte les deux signatures, l'ancienne et la nouvelle.
3. **Retirer l'entrée de l'ancienne clé** de `config/signing-keys.v1.json`, par un commit revu et signé (`git commit -s`). Dès lors, une signature qui la nomme est une signature inconnue (règle S5) : ignorée et comptée, jamais vérifiée. Un enregistrement qui ne porterait que l'ancienne signature est refusé (`signature-key-unknown`) : c'est pourquoi l'étape 2 précède celle-ci.
4. **Décommissionner l'ancienne clé scellée** (effacer les copies, garder UNE copie archivée chiffrée hors ligne pendant 7 ans pour audit).
5. **Signer désormais avec la nouvelle clé seule.**

---

## Protocole de révocation (clé compromise)

Si vous découvrez, ou soupçonnez, un accès non autorisé à la clé privée :

1. **Arrêt immédiat :** ne plus rien signer avec cette clé.
2. **Dater la révocation.** `revokedAt` est l'instant le plus ancien à partir duquel la clé ne doit plus être crue : au plus tard l'instant de la découverte (`revokedAt <= revocationWitness.discoveredAt`, règle K6), et plus tôt si l'exposition a commencé avant, par exemple au dernier instant où la clé est connue saine. Une révocation datée après la découverte laisserait valide une signature faite entre les deux : le contrat la refuse. `revokedAt` reste strictement postérieur à `activatedAt` (K5).
3. **Mettre à jour l'entrée** de la clé dans `config/signing-keys.v1.json` : l'entrée reste au registre, `revokedAt` passe de `null` à l'instant choisi, et `revocationReason` et `revocationWitness` deviennent obligatoires (K6) :
   ```json
   "revokedAt": "2026-07-23T09:00:00.000Z",
   "revocationReason": "suspected compromise of the offline machine; last known safe use at 09:00 UTC",
   "revocationWitness": {
     "signatory": "key-custodian",
     "discoveredAt": "2026-07-23T14:30:00.000Z"
   }
   ```
   `revocationReason` décrit la clé et l'incident, jamais une personne ; `signatory` est un rôle (K7). L'identité de qui révoque est celle du trailer `Signed-off-by` du commit revu.
4. **Effet chez les vérificateurs.** L'activité d'une clé se juge à l'instant de la vérification (règle S6) : tout enregistrement qu'elle a signé cesse de se vérifier dès `now >= revokedAt`, quelle que soit la date que le manifeste se donne. Un enregistrement à double signature dont l'une est révoquée est refusé en entier (S9), même si l'autre se vérifie : le producteur le réémet sans la signature compromise.
5. **Générer une nouvelle clé** (cérémonie complète) et re-signer avec elle ce qui doit rester vérifiable.
6. **Audit :** examiner ce que la clé compromise a signé (historique git, journaux d'audit).

---

## Invariants de sécurité (contrôle / checkpoint)

### ✓ Machine air-gappée

- [ ] Pas d'interface réseau active au moment de la génération.
- [ ] Pas de SSH, pas de partage de fichiers réseau (Samba, NFS).
- [ ] Pas de disque externe connecté sauf le support de sortie (`--out`) de l'étape 3.

### ✓ Clé privée

- [ ] **Jamais en clair sur disque** (sauf dans la RAM du script de génération, qui s'efface immédiatement).
- [ ] **Jamais committée dans git** ou aucun historique versionné.
- [ ] **Jamais transmise électroniquement** (sauf scellée + une seule fois vers USB hors-ligne).
- [ ] Scellée avec un mot de passe maître fort (32+ caractères, aléatoire, noté hors-ligne).

### ✓ Clé publique

- [ ] Enregistrée dans `config/signing-keys.v1.json` (une source de vérité).
- [ ] Validée au commit via `check:secret-scan` (pas de private-key marker).
- [ ] Accessible à quiconque doit vérifier les signatures (publique par définition).

### ✓ Audit trail

- [ ] Commit Git du manifest inclut le `signingKeyId` et la date de la cérémonie, signé (`Signed-off-by`) par qui enregistre.
- [ ] Témoin de l'entrée : rôle (`signatory`) et instant d'attestation, sans nom ni adresse.
- [ ] Copie de backup du fichier scellé sécurisée hors-ligne (coffre-fort, duplication géographique).

---

## Point d'enregistrement (intégration avec les briques)

### Où la clé publique est-elle consommée ?

Le manifest `config/signing-keys.v1.json` est lu par le **consommateur** qui vérifie, jamais par une bibliothèque de vérification. Le consommateur charge le registre, refuse en bloc un registre qui enfreint une règle K, et passe les clés à la bibliothèque ; une clé ne vérifie que si elle est active à l'instant de la vérification (`activatedAt <= now < revokedAt`, règle S6) et autorisée pour le type du manifeste (`artifactTypes`, règle S7) :

1. **Paquet provenance d'`artifact-verification`** (`packages/provenance/src/index.ts`) — prend la clé publique **en paramètre** et ne lit aucun registre ; ce dépôt réserve le choix des clés au consommateur (son `AGENTS.md`). Aucune bibliothèque d'`artifact-verification` ne lit `config/signing-keys.v1.json` elle-même.
2. **Vérification des preuves** (future) — même contrat : la clé arrive en paramètre, chargée par le consommateur.
3. **`tools/review/fanout.ts`** (consommateur initial) — enveloppe les preuves de revue via `guardEvidence()` ; c'est à ce niveau, consommateur, que le registre sera lu.

### Intégration (WP-G2-Z02, after key ceremony acceptance)

Une fois le manifest enregistré et le workflow de cérémonial approuvé :

1. **Chargement côté consommateur** : chaque consommateur lit `config/signing-keys.v1.json` et passe les clés à la bibliothèque de vérification, qui garde la clé en paramètre.
2. **Activation du signing** dans `tools/review/fanout.ts` : appel au runtime propriétaire pour signer (ex. via API HSM distante, ou appel système sécurisé).
3. **Vérification renforcée** : toute enveloppe générée après WP-G2-Z02 doit être signée ; les anciennes HMAC sont tolérées (migration progressive).

---

## Troubleshooting

### Q : Le script refuse de s'exécuter ("CI detected")

**R :** Vérifiez que vous n'êtes pas en environment CI (GitHub Actions, GitLab CI, etc.). Le script détecte `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `TRAVIS`, `BUILDKITE` et sort en code 4. Exécutez localement sur votre machine air-gappée.

### Q : Quel runtime pour la cérémonie ?

**R :** Le Bun épinglé par ce dépôt suffit (`toolchains/bun.json`, champs `version` et `revision`). Le scellement n'emploie que scrypt et AES-256-GCM de `node:crypto`, présents dans ce Bun (décision du propriétaire du 2026-11-17). Vérification avant la cérémonie, qui doit afficher `true` :

```bash
bun -e 'console.log(require("node:crypto").getCiphers().includes("aes-256-gcm"))'
```

Les tests de scellement de `tools/security/keygen-ceremony.test.ts` tournent sous ce Bun. Un seul cas dépend du runtime : la lecture d'une ancienne enveloppe ChaCha20-Poly1305, sautée là où ce chiffrement manque, ce que `bun test` imprime nommément (`legacy envelope read skipped: 1, cipher chacha20-poly1305 unavailable in this runtime`) ; le cas inverse, le refus nommé, tourne alors à sa place.

### Q : `--verify-sealed` refuse avec `SEAL_LEGACY_CIPHER_UNAVAILABLE`

**R :** Le fichier est une ancienne enveloppe (163 octets, sans octet de version), scellée en ChaCha20-Poly1305, et le runtime n'a pas ce chiffrement. Mesure du 2026-11-17 : Bun 1.4.0 (épinglé) et 1.4.4 (BoringSSL) ne l'ont pas, Node 26 (OpenSSL) l'a. Aucune clé n'a été enregistrée avec ce format ; s'il en existe une, la vérifier sous un runtime qui fournit `chacha20-poly1305`, puis refaire la cérémonie pour obtenir une enveloppe de version `0x01`.

### Q : `--verify-sealed` refuse avec `SEAL_UNKNOWN_VERSION`

**R :** Le premier octet du fichier n'est pas `0x01` : fichier d'un autre outil, d'une version plus récente, ou altéré. Ne pas réessayer avec une autre phrase de passe ; comparer l'empreinte SHA-256 du fichier à celle notée à l'étape 7.

### Q : Je n'ai pas de Bun installé

**R :** Sur une machine connectée, téléchargez l'archive du Bun épinglé depuis la release durable nommée dans `toolchains/bun.json` (`durableRelease.tag`), vérifiez son SHA-256 contre `assets.<plateforme>.sha256` du même fichier, transférez-la sur USB, puis contrôlez `bun --revision` contre le champ `revision` sur la machine air-gappée avant la cérémonie.

### Q : J'ai perdu le mot de passe maître

**R :** Le fichier scellé devient inutile sans le mot de passe (par design). Vous devez générer une nouvelle paire (rotation).

### Q : Puis-je tester avec une fausse clé d'abord ?

**R :** Oui ! Le script tolère un mode dev (passez `--dev-key` pour générer une clé éphémère de test, non enregistrée). Utilisez cela pour valider votre setup avant la cérémonial réelle.

### Q : Comment puis-je vérifier que la clé publique dans le repo est la bonne ?

**R :** L'identifiant est l'empreinte : `ed25519-` suivi du SHA-256 des 32 octets bruts de la clé publique (règle K3). Extrayez le PEM de l'entrée du registre (OpenSSL ne lit pas le JSON), recalculez l'empreinte et comparez-la à l'identifiant de l'entrée et à la copie papier ou USB de la cérémonie :

```bash
jq -r --arg id "<identifiant>" '.keys[] | select(.signingKeyId == $id) | .publicKey' config/signing-keys.v1.json \
  | openssl pkey -pubin -outform DER | tail -c 32 | sha256sum | cut -d' ' -f1 | sed 's/^/ed25519-/'
# Doit afficher <identifiant>. Le PEM se compare aussi octet pour octet à <identifiant>.pub.pem du support.
```

---

## Références

- **ADR-0007** (Gate B, OOM diagnostic optionnel, K3 security kernel).
- **PROMOTION-DOSSIER.md** (envelope-v1, deferral mentioning WP-G2-Z01).
- **packages/provenance/** (AgentContributorLineage v1, signature Ed25519).
- **tools/security/keygen-ceremony.ts** (script de génération, sealing, public-key output).
- **Contrat `signing-keys.v1`** du dépôt des contrats : `contracts/schemas/signing-keys.v1.schema.json` et `contracts/artifact-manifest-signatures-v1/SEMANTICS.md` (règles K0 à K7, S0 à S10, cycle de vie des clés).
- **RFC 8037** (Ed25519, CFRG elliptic curve signatures).
- **NIST SP 800-132** (PBKDF2, password hashing — scrypt equivalent for modern setups).

---

## Sign-off

La cérémonie ne se signe pas dans ce document. Qui l'a exécutée, et qui en est témoin, signe le commit qui enregistre la clé (`git commit -s`, trailer `Signed-off-by`) ; le registre ne porte que le rôle du témoin (`witness.signatory`) et l'instant de son attestation (règle K7).

**Une seule source de vérité pour l'identité de cette clé : le commit git du manifest dans `config/signing-keys.v1.json`.**
