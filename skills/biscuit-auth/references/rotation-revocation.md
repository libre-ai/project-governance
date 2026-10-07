<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Biscuit — rotation et révocation

Référence de `../SKILL.md` (section « Clés et cryptographie »). Chargée seulement quand la tâche touche réellement la rotation de clés ou la révocation d'un token — jamais préchargée avec le corps principal.

## Key rotation

1. Générer la nouvelle paire de clés.
2. Déployer la nouvelle clé publique sur tous les services — supporter deux clés simultanément le temps de la bascule.
3. Basculer le service d'auth vers la nouvelle clé privée.
4. Attendre que tous les anciens tokens expirent (TTL) avant de retirer l'ancienne clé publique.

- Ne jamais invalider tous les tokens d'un coup (UX catastrophique).
- Planifier la rotation tous les 90 jours minimum.

## Revocation

- Chaque token a un unique root block ID (identifiant de l'authority block).
- Stocker les block IDs révoqués en base (table `revoked_tokens(block_id, revoked_at, reason)`).
- Vérifier avant l'authorizer : si le block ID est dans la table, rejeter (401).
- Cache en mémoire avec TTL court (30-60 s) pour éviter un hit DB à chaque requête.
- Révocation en masse : par `user_id` ou `tenant_id` (tous les tokens d'un utilisateur/tenant).
- Cleanup : supprimer les entrées de révocation plus vieilles que le TTL max des tokens.

## Sérialisation

`to_base64()` pour transport HTTP, `to_bytes()` pour stockage binaire.
