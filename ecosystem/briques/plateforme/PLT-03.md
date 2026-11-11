# PLT-03 — Canaux de distribution

## Contexte

ADR-0042 §8 pose que toute distribution d'une application à un tiers exige un compte Apple Developer, la signature et la notarisation du binaire, et la déclaration de l'hôte de native messaging auprès de chaque navigateur. ADR-0054 §4 rend P02 commercial par distribution signée et notarisée (D81). ADR-0064 D7, encore proposé, nomme le paquet Flatpak pour le palier Linux. Aucun dépôt de l'inventaire ne porte de chaîne de distribution d'application.

## Ce que la brique ferme

- L'application remise à un tiers sans signature ni ticket de notarisation : D98 exige un ticket par release candidate.
- Le canal qui devient la source : la forge reste canonique et les artefacts restent exportables (I-12).
- La release exposée sans son évidence : I-20 lie chaque release à son évidence, et I-15 n'expose que ce qui est vérifiable.

## Ce qu'elle ne fait pas

- Elle ne construit pas l'artefact : PLT-04.
- Elle ne produit pas la signature : PRV-03.
- Elle ne déploie pas l'offre hébergée d'un produit : l'hébergement suit I-07 et relève d'EXE-02.

## Mesure

- Preuve citée : aucune. Les dépôts porteurs de coquille et de poste examinés le 2026-11-11 n'ont publié aucune release. La signature et la notarisation n'ont été exécutées sur aucun bundle Tauri (`docs/method/TAURI-SHELL.md` §6).
- Le relevé des canaux du 2026-10-22 est une analyse hors dépôt : il n'ancre rien ici.
- Prochaine preuve : un job de release d'un dépôt porteur qui produit un bundle signé, vérifie son ticket de notarisation et lie la release à son évidence.
