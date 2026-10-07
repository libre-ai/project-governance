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

1. Sur votre machine air-gappée, clonez le dépôt libre-ai en lecture seule (pas de SSH, pas de prise d'authentification).

   ```bash
   # Via USB ou copie locale
   # (ex. git clone depuis un clone préalable sur USB, ou rsync)
   git clone --depth 1 https://github.com/libre-ai/libre-ai.git libre-ai-repo
   cd libre-ai-repo
   ```

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

Le script `keygen-ceremony.ts` génère une paire Ed25519, dérive un identifiant de clé déterministe à partir de la clé publique, et prépare le scellement de la clé privée.

```bash
cd tools/security
# Exécuter le script de génération
bun keygen-ceremony.ts
```

**Avertissements attendus du script :**

- ⚠️ Vérification qu'on n'est PAS en CI (refuse si `CI=true` ou variables GitLab/GitHub détectées).
- ⚠️ Rappel que cette machine DOIT être air-gappée et que la clé privée ne doit PAS traverser le réseau.

**Output du script :**

1. **Clé publique** (format SPKI PEM) → affichée sur stdout, à copier vers votre dépôt.
2. **KeyID** (dérivé déterministe de la clé publique) → affiché sur stdout, à mémoriser/noter.
3. **Instructions de scellement** → le script génère un payload scellé (chiffré + empreinte) à sauvegarder hors-ligne.

### Étape 4 : Examiner les outputs du script

Le script affiche en stdout (et optionnellement écrit dans des fichiers indiqués) :

```
===============================================
🔑 Ed25519 Key Pair Generated Successfully
===============================================
⚠️  CRITICAL: You are responsible for the private key custody.
⚠️  CRITICAL: Air-gap compliance required — no network until sealing is complete.

Public Key (SPKI PEM, for repo registration):
-----BEGIN PUBLIC KEY-----
<... base64 encoded public key ...>
-----END PUBLIC KEY-----

KeyID (deterministic, derived from public key):
prod_key_20260722_<hash>

Next: Use the sealed private key path below to secure your private key offline.
Sealed Private Key Envelope: /tmp/private-key-sealed-<date>.bin
Sealing Instructions: Follow KEY-CEREMONY-RUNBOOK.md Step 5.
===============================================
```

**À copier :**

- La clé publique (bloc PEM complet).
- Le keyID (pour la suite).
- Le chemin du fichier scellé `/tmp/private-key-sealed-<date>.bin`.

### Étape 5 : Sceller la clé privée avec un mot de passe maître

La clé privée est pré-scellée par le script (chiffrement AEAD Chacha20-Poly1305 + clé dérivée via scrypt), mais vous devez fournir un **mot de passe maître** fort pour le scrypt.

1. **Choisir un mot de passe maître** (minimum 32 caractères, mélange alphanumériques + symboles) :

   ```bash
   # Exemple (à adapter, NE PAS copier) :
   # "Librarie-42!Chiffre~Mur|Soleil(Zèbre)2026"
   ```

2. **Re-sceller manuellement** (optionnel, ou fourni par le script) :

   ```bash
   # Si le script offre une réparation interactive :
   bun keygen-ceremony.ts --reseal-with-passphrase "votre-mot-de-passe-maître"
   ```

3. **Sauvegarder le mot de passe** :
   - **Sur papier chiffré :** Écrivez le mot de passe sur du papier, enfermez-le dans une enveloppe cachée (ex. coffre-fort domestique, zone sécurisée).
   - **Divisé (Shamir) :** Optionnel, distribuez 3 parts du mot de passe à 3 personnes de confiance, exigez 2 signatures pour reconstituer (scheme 3-de-5).
   - **Jamais en clair électroniquement,** jamais en plaintext sur le disque (sauf écran temporaire du script).

4. **Vérifier le scellement :**
   ```bash
   # Le fichier scellé doit être opaque (binaire, non-lisible)
   ls -l /tmp/private-key-sealed-*.bin
   file /tmp/private-key-sealed-*.bin  # Doit indiquer "data"
   ```

### Étape 6 : Sauvegarder hors-ligne et vérifier l'intégrité

1. **Copier le fichier scellé sur USB :**

   ```bash
   cp /tmp/private-key-sealed-*.bin /mnt/usb/offline-keys/private-key-sealed-prod-2026-07-22.bin
   ```

2. **Vérifier l'intégrité (checksum SHA-256) :**

   ```bash
   sha256sum /tmp/private-key-sealed-*.bin > /mnt/usb/offline-keys/private-key-sealed-prod-2026-07-22.bin.sha256
   # Plus tard (après ejection/réinsertion) :
   sha256sum -c private-key-sealed-prod-2026-07-22.bin.sha256
   ```

3. **Sauvegarder aussi :**
   - Copie du **keyID** sur papier ou USB (à titre informatif, non-critique).
   - Copie du **Public Key PEM** sur USB (pour reconstruction post-disaster).

4. **Éjecter l'USB et stocker hors-ligne :**
   ```bash
   umount /mnt/usb
   # Rangez l'USB dans un coffre-fort, une zone sécurisée, avec duplication géographique si needed.
   ```

### Étape 7 : Enregistrer la clé publique dans le dépôt

Retour sur votre machine de développement (connectée, post-cérémonial) :

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
         "id": "prod_key_20260722_<hash>",
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

   - keyId: prod_key_20260722_<hash>
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

1. **Générer une nouvelle paire** en reprenant la cérémonial complète (Étapes 1-6).
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
- [ ] Pas de disque externe connecté jusqu'à l'étape 6 (sauvegarde).

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

Le manifest `config/signing-keys.v1.json` est lu par :

1. **`packages/provenance/src/index.ts`** — `verifyLineage()` charge la clé publique depuis le manifest et vérifie la signature Ed25519 du digest de lignage.
2. **`packages/proof/src/index.ts`** (future) — `verifyProof()` chargera la même clé pour vérifier les preuves signées.
3. **`tools/review/fanout.ts`** (consommateur initial) — enveloppe les preuves de revue via `guardEvidence()`, qui utilisera à terme la clé publique pour la signature.

### Intégration (WP-G2-Z02, after key ceremony acceptance)

Une fois le manifest enregistré et le workflow de cérémonial approuvé :

1. **Mise à jour de `packages/provenance/`** pour charger les clés publiques depuis `config/signing-keys.v1.json` plutôt que de les passer en paramètres.
2. **Activation du signing** dans `tools/review/fanout.ts` : appel au runtime propriétaire pour signer (ex. via API HSM distante, ou appel système sécurisé).
3. **Vérification renforcée** : toute enveloppe générée après WP-G2-Z02 doit être signée ; les anciennes HMAC sont tolérées (migration progressive).

---

## Troubleshooting

### Q : Le script refuse de s'exécuter ("CI detected")

**R :** Vérifiez que vous n'êtes pas en environment CI (GitHub Actions, GitLab CI, etc.). Le script détecte `CI=true`, `GITHUB_ACTIONS`, `GITLAB_CI`. Exécutez localement sur votre machine air-gappée.

### Q : Je n'ai pas de Bun installé

**R :** Téléchargez Bun via `https://bun.sh` sur une autre machine, transférez le binaire sur USB, puis copiez-le sur votre machine air-gappée avant la cérémonial.

### Q : J'ai perdu le mot de passe maître

**R :** Le fichier scellé devient inutile sans le mot de passe (par design). Vous devez générer une nouvelle paire (rotation).

### Q : Puis-je tester avec une fausse clé d'abord ?

**R :** Oui ! Le script tolère un mode dev (passez `--dev-key` pour générer une clé éphémère de test, non enregistrée). Utilisez cela pour valider votre setup avant la cérémonial réelle.

### Q : Comment puis-je vérifier que la clé publique dans le repo est la bonne ?

**R :** Comparez le fingerprint public-key en base64 avec une copie papier ou USB de la cérémonial. Utilisez OpenSSL pour extraire le fingerprint :

```bash
openssl pkey -in config/signing-keys.v1.json -pubout -text -noout | grep -A 4 "pub:"
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
