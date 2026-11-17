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

2. Vérifiez la présence du script `tools/security/keygen-ceremony.ts` et du runtime Bun.
   ```bash
   ls tools/security/keygen-ceremony.ts
   which bun || echo "Bun non trouvé: installer https://bun.sh"
   ```

### Étape 2 : Vérifier l'isolation réseau avant chaque étape

Avant de lancer le script de génération, vérifiez que la machine est toujours isolée :

```bash
netstat -an 2>/dev/null | grep -E 'ESTABLISHED|LISTEN' && echo "ERREUR: connexions réseau détectées" || echo "OK: isolée"
```

### Étape 3 : Générer la paire de clés Ed25519

L'outil génère une paire Ed25519, dérive l'identifiant de clé, lit la phrase de passe, scelle la clé privée et écrit deux fichiers dans le répertoire `--out`, qui est obligatoire. Lancez-le depuis la racine du clone, avec `--out` sur le support amovible :

```bash
bun tools/security/keygen-ceremony.ts --out /mnt/usb/offline-keys > /mnt/usb/offline-keys/registry-entry.json
```

**Refus attendus de l'outil (code 4, rien d'écrit) :**

- une variable de CI posée (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `TRAVIS`, `BUILDKITE`) ;
- un répertoire `--out` situé dans un dépôt git (entrée `.git` dans lui ou l'un de ses parents) ;
- un fichier `<identifiant>.sealed` ou `<identifiant>.pub.pem` déjà présent dans `--out` ;
- une phrase de passe de moins de 32 caractères, ou deux saisies différentes.

Une phrase de passe en argument (`--passphrase …`) est refusée en usage (code 2) : elle serait visible dans la liste des processus et l'historique du shell.

### Étape 4 : Examiner les sorties de l'outil

Les messages pour l'opérateur vont sur la sortie d'erreur. La sortie standard ne porte que l'entrée de registre, en JSON, redirigée ci-dessus dans `registry-entry.json` :

```json
{
  "id": "<64 caractères hexadécimaux>",
  "algorithm": "Ed25519",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "purpose": "AgentContributorLineage v1, Proof v1 origin signatures",
  "activatedAt": "<date ISO 8601 de la cérémonie>",
  "revokedAt": null
}
```

L'identifiant est le SHA-256, en hexadécimal minuscule, des 32 octets bruts de la clé publique. Il ne dépend ni de la date ni de l'encodage PEM : tout vérificateur le recalcule depuis la clé.

Fichiers écrits dans `--out`, dans cet ordre :

1. `<identifiant>.sealed`, mode 0600 : l'enveloppe scellée. L'outil l'écrit d'abord sous un nom temporaire, la relit, la descelle en mémoire et compare la clé publique qu'elle contient à celle générée ; il ne lui donne son nom final qu'après ce contrôle.
2. `<identifiant>.pub.pem` : la clé publique, écrite seulement après l'enveloppe.

Un échec à n'importe quelle étape supprime ce que l'outil a écrit et sort en code 1, sans fichier public.

### Étape 5 : Saisir la phrase de passe maître

L'enveloppe est scellée par scrypt (N=16384, r=8, p=1) puis ChaCha20-Poly1305, sous la phrase de passe maître que vous saisissez pendant l'étape 3.

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

Retour sur votre machine de développement (connectée, post-cérémonial). L'outil n'écrit jamais ce registre : recopiez l'entrée de `registry-entry.json` dans `keys`, puis ajoutez le témoin.

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
         "id": "<SHA-256 hex des 32 octets bruts de la clé publique>",
         "algorithm": "Ed25519",
         "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
         "purpose": "AgentContributorLineage v1, Proof v1 origin signatures",
         "activatedAt": "2026-07-22T00:00:00.000Z",
         "revokedAt": null,
         "witness": {
           "signatory": "owner@libre-ai.example",
           "attestedAt": "2026-07-22T12:00:00.000Z",
           "comment": "Initial key ceremony, air-gapped generation, HSM-backed"
         }
       }
     ]
   }
   ```

3. **Valider le format :**

   ```bash
   bun run check:source  # Inclut une validation du JSON
   ```

4. **Committer avec DCO signoff :**
   ```bash
   git add config/signing-keys.v1.json
   git commit -s -m "feat(security): register initial Ed25519 signing key (WP-G2-Z01)

   - keyId: <identifiant>
   - Algorithm: Ed25519
   - Purpose: origin signature for AgentContributorLineage v1
   - Generated via air-gapped key ceremony 2026-07-22

   WP-G2-Z01"
   ```

---

## Protocole de rotation (futur, clé compromise)

### Quand générer une nouvelle clé ?

- **Rotation programmée :** Tous les 2 ans (bonne hygiène cryptographique).
- **Compromise suspecte :** Si la clé privée est potentiellement exposée (ex. machine compromise, accès non autorisé au HSM), générer immédiatement.
- **Algorithme périmé :** Si la recherche cryptographique découvre une faiblesse en Ed25519 (très unlikely, mais à surveiller).

### Processus de rotation :

1. **Générer une nouvelle paire** en reprenant la cérémonial complète (Étapes 1-7).
2. **Ajouter la nouvelle clé** au manifest `config/signing-keys.v1.json` avec `activatedAt` et marquer l'ancienne avec `revokedAt`.
3. **Décommissionner l'ancienne clé scellée** (effacer les copies, garder UNE copie archivée chiffre hors-ligne pendant 7 ans pour audit).
4. **Migrer les nouveaux signings** vers la nouvelle clé immédiatement.
5. **Vérifier** que les systèmes de vérification acceptent les deux clés (période de transition).

---

## Protocole de révocation (clé compromise)

Si vous découvrez un accès non autorisé à la clé privée :

1. **Arrêt immédiat :** Ne pas signer de nouveaux lignages avec cette clé.
2. **Mettre à jour le manifest :**
   ```json
   "revokedAt": "2026-07-23T14:32:00.000Z",
   "revocationReason": "suspected compromise — machine breach",
   "revocationWitness": {
     "signatory": "owner@libre-ai.example",
     "discoveredAt": "2026-07-23T14:30:00.000Z"
   }
   ```
3. **Générer une nouvelle clé** (rotation immédiate).
4. **Audit :** Examiner les enveloppes signées par la clé compromise (historique de git + audit logs).

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

- [ ] Commit Git du manifest inclut le keyID et la date de la cérémonial.
- [ ] Witness du signatory + timestamp d'attestation.
- [ ] Copie de backup du fichier scellé sécurisée hors-ligne (coffre-fort, duplication géographique).

---

## Point d'enregistrement (intégration avec les briques)

### Où la clé publique est-elle consommée ?

Le manifest `config/signing-keys.v1.json` est lu par le **consommateur** qui vérifie, jamais par une bibliothèque de vérification. Le consommateur charge le registre, choisit les clés actives (non révoquées) et les passe à la bibliothèque :

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

### Q : Le scellement échoue (code 1, chiffrement inconnu)

**R :** Le scellement exige `chacha20-poly1305` dans `node:crypto`. Mesure du 2026-11-17 : Bun 1.4.4 et 1.3.14 (BoringSSL) ne l'ont pas, Node 26 (OpenSSL) l'a. L'outil sort alors en code 1 sans rien écrire. Vérifier avant la cérémonie : `bun -e 'console.log(require("node:crypto").getCiphers().includes("chacha20-poly1305"))'` doit afficher `true`.

### Q : Je n'ai pas de Bun installé

**R :** Téléchargez Bun via `https://bun.sh` sur une autre machine, transférez le binaire sur USB, puis copiez-le sur votre machine air-gappée avant la cérémonial.

### Q : J'ai perdu le mot de passe maître

**R :** Le fichier scellé devient inutile sans le mot de passe (par design). Vous devez générer une nouvelle paire (rotation).

### Q : Puis-je tester avec une fausse clé d'abord ?

**R :** Oui ! Le script tolère un mode dev (passez `--dev-key` pour générer une clé éphémère de test, non enregistrée). Utilisez cela pour valider votre setup avant la cérémonial réelle.

### Q : Comment puis-je vérifier que la clé publique dans le repo est la bonne ?

**R :** L'identifiant est l'empreinte : le SHA-256 des 32 octets bruts de la clé publique. Extrayez le PEM de l'entrée du registre (OpenSSL ne lit pas le JSON), recalculez l'empreinte et comparez-la à l'identifiant de l'entrée et à la copie papier ou USB de la cérémonie :

```bash
jq -r --arg id "<identifiant>" '.keys[] | select(.id == $id) | .publicKey' config/signing-keys.v1.json \
  | openssl pkey -pubin -outform DER | tail -c 32 | sha256sum
# Doit afficher <identifiant>. Le PEM se compare aussi octet pour octet à <identifiant>.pub.pem du support.
```

---

## Références

- **ADR-0007** (Gate B, OOM diagnostic optionnel, K3 security kernel).
- **PROMOTION-DOSSIER.md** (envelope-v1, deferral mentioning WP-G2-Z01).
- **packages/provenance/** (AgentContributorLineage v1, signature Ed25519).
- **tools/security/keygen-ceremony.ts** (script de génération, sealing, public-key output).
- **RFC 8037** (Ed25519, CFRG elliptic curve signatures).
- **NIST SP 800-132** (PBKDF2, password hashing — scrypt equivalent for modern setups).

---

## Sign-off

Cérémonial exécuté et validé par : `<your name>` · Date : `<date>`
Witness : `<optional: security team lead, external auditor>` · Attesté le : `<date>`

**Une seule source de vérité pour l'identité de cette clé : le commit git du manifest dans `config/signing-keys.v1.json`.**
