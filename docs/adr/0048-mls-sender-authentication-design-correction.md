# ADR-0048 — Correction du modèle d'authentification MLS du design de collaboration, et invariant posé avant tout code MLS

- **Statut :** accepted — arbitrage propriétaire du 2026-10-10 en chat ; I-34 et D70 sont en vigueur à la fusion
- **Date :** 2026-10-10
- **Arbitrage :** le propriétaire a retenu, sur la question Q1 du tri des menaces non couvertes du modèle de menace, l'option « ADR correctif, puis invariant posé avant tout code MLS », et a classé le conflit d'édition hors ligne en risque accepté. Owner-arbitration: 2026-10-10 — décisions de tri des menaces arbitrées en chat
- **Portée :** l'authentification de l'expéditeur des contenus échangés entre membres d'un groupe de collaboration chiffré de bout en bout (MLS, RFC 9420), et l'usage des secrets exportés de MLS.
- **Amende :** `docs/parity/design/DESIGN-collab-v2-signable.md` §11, résolutions R4 et R5, signées « owner, 2026-07-23 » (`:390`, `:400`, `:402`, `:406`), ainsi que les passages du même document qui en dépendent (§3 « Accord de clé groupe », étapes 2 et 3, `:76-84` ; §6 « Layer-2 », contrat critique, `:218-222`). Le texte signé est conservé en place, marqué amendé, et la version corrigée est écrite à côté.
- **Applique :** I-17 (surface à touche humaine fermée : registre et ADR sous signature) ; I-24 (décision par question structurée sur contexte restitué).
- **Autorise :** l'inscription de l'invariant I-34 et de la décision D70 ; l'écriture des vecteurs rouges d'I-34 dans l'autorité des contrats ; la mise à jour des lignes du modèle de menace qui portent la collaboration chiffrée.
- **N'autorise pas :** l'écriture d'un code MLS, l'intégration d'OpenMLS ou l'ouverture d'une capacité de collaboration dans `collaborative-data-sync` ; la modification d'un contrat verrouillé ; une revue cryptographique tenue pour faite (la porte D4 d'ADR-0011 reste fermée).

## Contexte

Le design de collaboration temps réel (`DESIGN-collab-v2-signable.md`) a été signé par le propriétaire le 2026-07-23 après une passe de revue cryptographique, dont il consigne quatre résolutions sous un principe directeur juste : « utiliser les mécanismes natifs de MLS RFC 9420, ne pas rouler de crypto ad-hoc » (`:392`). Deux de ces résolutions contredisent ce principe et le texte de la RFC.

**R5 est faux sur les faits.** Il affirme (`:402`) que « PrivateMessage n'a PAS de champ signature en RFC 9420 (la signature n'existe que dans PublicMessage, §5.1.1) » et que l'expéditeur est lié « via le MAC AEAD calculé sur `authenticated_data` ». Le texte de la RFC, relu le 2026-10-10 sur `https://www.rfc-editor.org/rfc/rfc9420.txt` :

- §6.1 définit `FramedContentAuthData`, dont le premier champ est `opaque signature<V>`, calculé par `SignWithLabel(., "FramedContentTBS", FramedContentTBS)` sous la clé de signature de la feuille de l'expéditeur ; « Recipients of an MLSMessage MUST verify the signature ».
- §6.3.1 définit `PrivateMessageContent` : le contenu chiffré porte `FramedContentAuthData auth`. La signature voyage donc **dans** le ciphertext d'un PrivateMessage, et « the application MUST check that the FramedContentAuthData is valid ».
- §6 (introduction) : le framing commun fournit le chiffrement « as well as signing to authenticate the sender », pour PublicMessage comme pour PrivateMessage.
- §16.5 distingue deux authentifications. La première, « a message originated from one of the members of the group », est garantie pour un message chiffré par l'AEAD sous une clé dérivée des secrets du groupe. La seconde, « a message originated from a particular member », est garantie par la signature numérique de chaque message.

Le MAC AEAD ne lie donc pas l'expéditeur : les clés du secret tree (§9) sont dérivables par tout membre de l'époque, et l'AEAD ne prouve que l'appartenance au groupe. Ce qui lie l'expéditeur, c'est précisément la signature que R5 dit absente. La conclusion de R5 (« un `k_epoch` partagé ne permet donc PAS de forger un delta attribué à autrui ») ne tient que si cette signature est vérifiée, ce que R5 ne demande pas.

**R4 supprime l'authentification entre membres.** Il prescrit (`:400`) `k_collab = Exporter("collab-epoch-data", context, 32)` pour la dérivation de clé, et le corps du design scelle les deltas Loro par AEAD direct sous une clé d'époque (`:77`, `:81-83`, `:220-221`). Une clé obtenue par `MLS-Exporter` (§8.5) est identique chez tous les membres de l'époque : un delta scellé sous elle authentifie au mieux l'appartenance au groupe, jamais l'expéditeur. Tout membre peut forger un delta attribué à un autre membre, et l'identifiant de participant transporté en clair (`:84`) n'est lié à rien. La RFC destine les secrets exportés à un usage « outside of MLS » (§8.5). Ici, ils remplaceraient le framing MLS lui-même.

**L'état du code.** `collaborative-data-sync@ed2c0fe` n'implémente pas MLS : `CryptoProvider` est une interface, et `SealedFrame` ne porte que `epoch`, `nonce`, `ciphertext` et `tag` (`packages/core/src/crypto-types.ts:33-38`), sans expéditeur authentifié. Aucun dépôt n'est au stade `proven`, et aucune production n'est possible avant activation. L'exposition est nulle aujourd'hui. C'est donc le moment de corriger : le design est la seule spécification que le premier code MLS lirait.

## Options

- **(A, retenue)** ADR correctif, puis un invariant posé avant tout code MLS. La correction est opposable, et l'invariant rend tout code MLS non conforme rouge par vecteurs avant sa fusion.
- **(B)** Corriger le design sans invariant. Le design reste non normatif (le modèle de menace le qualifie ainsi), et rien n'empêcherait un code de suivre l'ancien R4.
- **(C)** Différer jusqu'à l'activation de `collaborative-data-sync`. L'erreur resterait dans le seul document qu'un implémenteur lirait, sous une signature propriétaire qui lui donne autorité.

## Décision

1. **R5 est corrigé.** Un message applicatif MLS envoyé en PrivateMessage porte la signature de son expéditeur dans `FramedContentAuthData` (RFC 9420 §6.1, §6.3.1). Le destinataire vérifie cette signature sous la clé de signature de la feuille désignée par l'expéditeur avant d'appliquer le contenu, et refuse fermé en cas d'échec. L'AEAD sous les clés du secret tree n'authentifie que l'appartenance au groupe (§16.5).
2. **R4 est retiré.** Aucun contenu échangé entre membres n'est scellé par une clé dérivée d'`MLS-Exporter`, d'un `epoch_secret` ou d'un HKDF applicatif. Les deltas et instantanés Loro sont des messages applicatifs MLS natifs, protégés et authentifiés par le framing de la RFC. Un secret exporté ne sert qu'à un usage hors du contenu échangé (par exemple une clé de stockage local), sous une étiquette unique (§8.5).
3. **Invariant I-34**, posé avant tout code MLS. Son mécanisme est un jeu de vecteurs rouges, à écrire dans l'autorité des contrats avant la première pull request qui introduit du code MLS :
   - falsification d'expéditeur par un membre légitime (contenu signé par la feuille A, attribué à la feuille B) ;
   - signature absente, tronquée ou invalide ;
   - delta scellé sous une clé exportée ou dérivée hors du framing ;
   - message d'une époque périmée ou future ;
   - rejeu d'un message déjà appliqué.

   Chaque vecteur doit rougir contre une implémentation qui omet la propriété qu'il vise. **Aujourd'hui, ces vecteurs n'existent pas** et aucun code MLS n'existe : l'invariant interdit l'ordre inverse.
4. **R6 du registre résiduel** (conflit d'édition entre deux membres hors ligne) relève de l'expérience utilisateur et non de la cryptographie. Il est classé risque accepté. La fusion Loro est déterministe, et la résolution d'un conflit sémantique reste une affaire d'interface.
5. **Ce qui ne change pas.** R1 (handshake en PublicMessage, deltas en PrivateMessage, ordre FIFO par expéditeur), R2 (nonces délégués à MLS) et R3 (FS automatique, PCS par KeyUpdate) restent tels que signés. La porte D4 d'ADR-0011 (revue crypto et vie privée) reste fermée, et l'intégration d'OpenMLS reste un incrément cadré, non délégable.

## Conséquences

- `DESIGN-collab-v2-signable.md` porte, en tête et au §11, la mention de cet amendement. R4 et R5 signés restent lisibles, marqués amendés, avec R4′ et R5′ à côté. Les passages dépendants du §3 et du §6 sont marqués de la même façon.
- Le modèle de menace cite I-34 sur les trois menaces de la surface de collaboration et sur R5 du registre résiduel, et classe R6 en risque accepté. Le zero-day d'OpenMLS reste porté par R8.
- `collaborative-data-sync` devra remplacer `SealedFrame` par le framing MLS natif. Ce travail relève du dépôt et de son propre lot, pas de cet ADR.
- Le risque résiduel « métadonnées observables par le relais » (`:404`) est inchangé.

## Sources

- RFC 9420, texte relu le 2026-10-10 : §6 (introduction), §6.1 (`FramedContentAuthData`), §6.3.1 (`PrivateMessageContent`), §8.5 (`MLS-Exporter`), §16.5 (Authentication).
- `docs/parity/design/DESIGN-collab-v2-signable.md:76-84`, `:218-222`, `:390-406` sur `project-governance@0db7b41`.
- `libre-ai/collaborative-data-sync@ed2c0fe:packages/core/src/crypto-types.ts:33-38`.
- `docs/security/THREAT-MODEL.md`, surface « Collab relay » et registre résiduel R5, R6, R8.
