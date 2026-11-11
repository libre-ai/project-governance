# PLT-02 — Coquilles Tauri 2 et PWA

## Contexte

ADR-0057 §1 fait de Tauri 2 la coquille macOS du premier palier de tous les produits du catalogue (D96), avec un front écrit sur la stack web d'I-06, TypeScript strict et React 19. ADR-0054 §3 ajoute pour P02 une PWA. ADR-0064 D7, encore proposé, nommerait Linux au second palier. ADR-0063 D2, encore proposé, écrirait que la lisière d'interface ne porte aucune règle métier.

## Ce que la brique ferme

- Le front chargé depuis un hôte distant, ou la commande non déclarée : les contrôles d'ADR-0057 §2 les refusent, chacun avec son vecteur rouge.
- Le port ouvert sur la machine, qu'une page web pourrait viser (ADR-0042 §8).
- Le seuil de mémoire ajusté après la mesure : I-08 demande des critères et des preuves datées dans la fiche `project.v1.yaml` du produit, et le plafond s'y écrit avant la mesure, 512 MiB à défaut (D92, D98).
- La surface web servie sans ses en-têtes de sécurité : I-37 les exige de toute application de la flotte qui sert du HTML.

## Ce qu'elle ne fait pas

- Elle ne porte aucune fonction du cœur : sans PLT-01, elle n'a rien à présenter.
- Elle ne signe ni ne distribue l'application : PLT-03.
- Elle ne fixe ni promesse de plateforme ni seuil d'accessibilité : PLT-05 et PLT-07.

## Mesure

- Preuve citée : le test des contrôles de la coquille de P04. Il lance la coquille et exige qu'une variante privée de son contrôle soit vue rouge. Il ne tourne que sur macOS, et aucun job de CI ne le lançait à sa fusion (`docs/method/TAURI-SHELL.md` §6).
- Preuve écartée : le contrôle du champ `desktop_shell`. Au 2026-11-11, aucune fiche lue à la racine des dépôts publics actifs de l'inventaire ne le déclare.
- Prochaine preuve : une fiche de produit qui déclare `desktop_shell`, puis la qualification macOS de D98 sur un bundle signé.
