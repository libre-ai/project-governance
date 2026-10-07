# Qualification conservatoire des ressources — Notebook Core v2

> **Statut : preuve historique de rédaction, acceptée comme justification de borne par Gate A ;
> pas approbation Gate B.** Ces mesures utilisent uniquement le golden public. Elles ne qualifient
> ni le moteur expérimental courant, ni l'ABI WIT exécutée par un host, ni un navigateur.

## Méthode

Mesure le 2026-07-16 sur Apple M4 Max, 36 Gio, arm64, macOS 26.5.2, avec un harness Rust release
jetable reproduisant le profil public `Argon2id m=65536,t=3,p=1`, AES-256-GCM, Base64 et JCS. Chaque
ligne est un processus neuf mesuré par `/usr/bin/time -l`; le pic est le `maximum resident set size`.
Le harness n'est pas intégré au candidat : sa réimplémentation et sa revue restent bloquées par Gate A.

| Plaintext one-shot | Seal | Open | Pic RSS seal | Pic RSS open |
| ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 131,2 ms | 129,1 ms | 87,6 MiB | 88,3 MiB |
| 8 MiB | 214,6 ms | 206,9 ms | 145,4 MiB | 161,3 MiB |
| 16 MiB | 305,7 ms | 283,6 ms | 209,4 MiB | 209,1 MiB |
| 32 MiB | 488,0 ms | 445,0 ms | 337,4 MiB | 337,4 MiB |
| 100 MiB | 1,27 s | 1,17 s | 1 081,4 MiB | 1 065,3 MiB |

Les mesures incluent les copies du harness ; elles servent de majorant comparatif, pas de promesse de
production. L'ABI composant et le host navigateur ajouteront encore des copies. L'expérience ne mesure
pas les appareils faibles, les navigateurs, les erreurs d'allocation ou les écarts de temps anti-oracle.

## Décision verrouillée à Gate A

La limite initiale de 100 MiB est refusée : elle dépasse 1 GiB de RSS avant qualification navigateur.
Le candidat v2 est ramené à **16 MiB** de plaintext, **16 777 232 octets** de `C || T`,
**22 369 644 caractères** Base64 et **22 370 044 octets** d'enveloppe JCS maximale. La même borne brute s'applique à l'entrée Context v2, dont les contenus cumulés sont aussi limités à 16 MiB.

Gate A a accepté cette borne dans le contrat v2 verrouillé. Gate B doit encore mesurer le composant
réellement livrable avec son host dans chaque navigateur et classe d'appareil supportés. Dépasser
16 MiB exigerait désormais une nouvelle version de contrat et un futur format chunké, authentifié et
revu séparément ; aucune segmentation implicite n'est admise en v2.

## Pré-mesure du moteur expérimental `5395e45`

La passe Gate B `notebook-core-v2-gate-b-cryptography-runtime-5395e45-01` a reconstruit le module
WASM release SHA-256 `6ad5148c97ab3d0169a67a499460a1c1db24da694e023fdc1f546f5d61d20427`
deux fois à l'identique. Sur le harness natif release réel, un processus neuf par profil :

| Profil | Plaintext | Seal | Open | Pic RSS |
|---|---:|---:|---:|---:|
| `m=65536,t=3,p=1` | 16 MiB | 193 ms | 166 ms | 208 896 000 octets (~199,2 MiB) |
| `m=131072,t=4,p=4` | 16 MiB | 333 ms | 309 ms | 276 004 864 octets (~263,2 MiB) |

Ces échantillons ponctuels respectent les plafonds natifs proposés, mais ne sont ni des p95 ni des mesures de l'ABI/host navigateur. La Gate B a donc été rejetée : la matrice navigateurs/appareils, les copies du host et les chemins OOM/trap restent à qualifier.

## Remédiation moteur/host sans changement de contrat

Le profilage historique par taille (1/8/16 MiB) et les essais différentiels temporaires à 16 MiB ont isolé AES-GCM logiciel comme coût dominant ; Argon2id reste fixe par profil et SHA-256/Base64/JCS sont secondaires. Aucun contournement cryptographique n'est conservé. La remédiation :

- emprunte les grandes chaînes de l'enveloppe pendant `open`, valide leur longueur Base64 avant allocation et ne décode le ciphertext qu'après libération de la matrice Argon2id ;
- calcule le digest par segments et émet directement l'enveloppe JCS exacte dans son buffer final, sans seconde copie canonique ni `String` Base64 intermédiaire ;
- sélectionne sur wasm32 le backend constant-time `fixslice64` déjà présent dans `aes 0.8.4`, au moyen du diff local auditable `third_party/rustcrypto-aes-0.8.4/BACKEND.patch` ; les schedules et états restent sous les features `zeroize` ;
- exige SIMD128 pour le backend SHA-256 WebAssembly épinglé ; l'inspecteur refuse désormais tout artefact sans instructions SIMD réelles ;
- qualifie le cycle du module par moteur sans jamais réutiliser une instance ou une mémoire linéaire : module compilé partagé dans Firefox, compilation par worker dans Chromium/WebKit.

Le WIT, les paramètres Argon2id/AES-GCM, les préimages AAD/digest, le golden, la limite 16 MiB, le plafond 512 MiB, les erreurs fermées et les budgets restent inchangés. `aes-wasm` a été refusé parce que son implémentation livrée désactive explicitement les mitigations de canaux auxiliaires ; `ring` a été refusé à cette frontière parce que sa clé AEAD étendue privée n'offre pas de destruction zéroïsante vérifiable.

## Protocole navigateur Gate B versionné

Le harness `tools/qualification/notebook-core-v2/performance.playwright.ts` exécute le composant verrouillé dans un worker et une instance WASM neufs par opération. Pour chacun des trois moteurs épinglés et chacun des deux profils KDF ci-dessus, il effectue deux warm-ups puis 20 itérations mesurées de seal et open sur 16 MiB. Chaque open vérifie les 16 MiB par index contre la fixture publique `0x5a`, liée au SHA-256 pré-calculé `55c7e25571a69216de25162f191bb2847201a09ee7efe46b5bada034acc695d5`, avant effacement best-effort. Cette vérification exacte évite une copie Web Crypto de qualification qui n'appartient pas au chemin produit, ainsi que les allocations d'itérateur par octet observées dans WebKit ; les entrées et enveloppes restent transférées et détachées du producteur.

Le cycle du module WASM immuable et sans import est qualifié par moteur. Firefox le compile une fois par page après capture du RSS de référence, puis le clone structurellement dans chaque worker jetable ; sa durée de compilation est ajoutée de façon conservatrice à **chaque** échantillon bout-en-bout. Chromium et WebKit ne reçoivent aucun module compilé de la page et compilent dans chaque worker, coût directement inclus dans le bout-en-bout ; le partage de code compilé reste ainsi limité au moteur qui en a besoin pour son budget RSS. Dans les deux chemins, l'instance, la mémoire linéaire et les états cryptographiques restent neufs par opération. Le host impose `terminate()` sur chaque issue avant de poursuivre. Les campagnes trap/OOM utilisent toujours leurs artefacts et workers dédiés.

Deux distributions sont conservées : temps passé dans l'API composant et temps bout-en-bout incluant la compilation comptabilisée ci-dessus, création/destruction du worker, instanciation, copies ABI et transferts. Le p95 est le rang `ceil(0,95 × 20)`. Le harness acquiert avant tout lancement un verrou exclusif global au cache Playwright, refuse un processus déjà actif, puis relève toutes les 20 ms le RSS cumulé de chaque processus dont la commande provient du chemin de cache épinglé. Cette sélection couvre aussi les sous-processus WebKit qui changent de groupe OS, sans additionner une campagne concurrente coopérative. Il rapporte le pic additionnel par rapport au navigateur vierge et la somme des tailles de toutes les mémoires linéaires instanciées après l'opération. Cette télémétrie de qualification repose sur l'horloge et `ps` du host, jamais sur un import WASM.

Quatre refus publics (`wrong-recovery-secret`, secret trop court, ciphertext/tag modifié et digest seul modifié) sont mesurés 20 fois après warm-up. Tous doivent rester `authentication-failed` sans plaintext ; les échantillons p50/p95 sont publiés, sans prétendre rendre Argon2id/AES strictement temps constant au niveau d'un navigateur multitâche.

Les budgets verrouillés sont p95 seal/open bout-en-bout `≤ 5 s` et pic RSS additionnel `≤ 256 MiB` pour le profil producteur, puis `≤ 10 s` et `≤ 512 MiB` pour le profil maximal. Ils ne sont pas modifiés. Le délai Playwright global passe de 15 à 30 minutes pour ne pas confondre une campagne séquentielle lente avec une faute d'opération ; les deadlines de chaque worker restent 30 secondes (15 secondes pour l'anti-oracle). Le script écrit la matrice complète avant de sortir en erreur si un budget échoue. `toolchains/notebook-resource-classes.json` définit trois classes disjointes : 8 Gio contrainte, 16–24 Gio courante et 32+ Gio de référence. Le host doit appartenir réellement à la classe sélectionnée ; ses bornes et le hash du manifeste sont inscrits dans les trois rapports puis comparés par le summarizer. Avant mesure, chaque navigateur doit aussi exposer le contexte sécurisé, Worker, transfert d'`ArrayBuffer`, Web Crypto, IndexedDB et 512 Mio de quota disponible sur l'origine de qualification ; l'exécution du composant ferme la capacité SIMD128. Le minimum produit candidat est désormais la classe 32+ Gio/12 CPU logiques qualifiée ; les classes 8 et 16–24 Gio restent des observations communautaires facultatives non supportées. Aucune extrapolation, simulation promue en preuve ou inférence vers le host produit n'est autorisée. Les résultats ne deviennent une preuve Gate B qu'une fois rejoués et archivés sur le commit immuable qu'ils désignent.

L'ADR-0007 maintient comme exigences les fautes mémoire internes et la reprise bornée du host après terminaison/crash. L'OOM réel du processus navigateur reste un diagnostic facultatif : les caps logiciels ne sont pas promus et l'épuisement global de RAM ou swap est interdit.
