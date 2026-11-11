# PLT-03 — Canaux de distribution

## Contexte

ADR-0042 §8 pose que toute distribution d'une application à un tiers exige un compte Apple Developer, la signature et la notarisation du binaire, et la déclaration de l'hôte de native messaging auprès de chaque navigateur. ADR-0054 §4 rend P02 commercial par distribution signée et notarisée (D81). ADR-0064 D7, encore proposé, nomme le paquet Flatpak pour le palier Linux. I-12 fait de GitHub la forge canonique. I-20 publie par défaut l'évidence de forge, dont les releases liées à leur évidence.

## Ce que la brique ferme

- L'application remise à un tiers sans signature ni ticket de notarisation : ADR-0057 §4 exige un ticket par release candidate (D98).
- Le canal qui devient la source : I-12 garde la forge canonique, et ses exports et artefacts empêchent toute dépendance de données irréversible.
- La release remise sans son évidence : I-20 lie chaque release à son évidence.

## Ce qu'elle ne fait pas

- Elle ne construit pas l'artefact : sans PLT-04, elle n'a rien à acheminer.
- Elle ne produit pas la signature : sans PRV-03, l'artefact qu'elle achemine n'est pas signé.
- Elle ne déploie pas l'offre hébergée d'un produit : EXE-02.

## Mesure

- Preuve citée : aucune. Aucune preuve citée ici n'exerce donc les trois points ci-dessus.
- Au 2026-11-11, l'API de la forge ne rend aucune release pour `personal-knowledge-workspace`, `square-control` ni `ai-work-supervision`.
- La signature et la notarisation ne sont pas vérifiées sur une coquille Tauri (`docs/method/TAURI-SHELL.md` §6).
- Prochaine preuve : un job de release d'un dépôt porteur qui produit un bundle signé, vérifie son ticket de notarisation et lie la release à son évidence.
