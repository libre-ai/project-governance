# PLT-02 — Coquilles Tauri 2 et PWA

## Contexte

ADR-0057 §1 fait de Tauri 2 la coquille macOS du premier palier de tous les produits du catalogue (D96). ADR-0054 §3 ajoute pour P02 une PWA. ADR-0064 D7, encore proposé, nomme Linux comme second palier et écrit son déclencheur : ce point n'est plus ouvert. La première coquille construite est celle de P04, dans `personal-knowledge-workspace`. Le gabarit et le champ de fiche `desktop_shell` vivent dans `project-governance`.

## Ce que la brique ferme

- Le front chargé depuis un hôte distant, ou la commande appelée sans avoir été déclarée : les contrôles d'ADR-0057 §2 les refusent, chacun avec son vecteur rouge (I-08).
- Le port ouvert sur la machine, que toute page web pourrait viser (ADR-0042 §8).
- Le seuil de mémoire ajusté après la mesure : le plafond s'écrit avant, 512 MiB à défaut (D92, D98).
- La surface web servie sans ses en-têtes de sécurité (I-37).

## Ce qu'elle ne fait pas

- Elle ne porte aucune logique métier : elle appelle PLT-01.
- Elle ne signe ni ne distribue l'application : PLT-03.
- Elle ne fixe ni promesse de plateforme ni seuil d'accessibilité : PLT-05 et PLT-07.

## Mesure

- Preuve citée : le test des contrôles de la coquille de P04. Il lance la coquille réelle et exige qu'une variante privée de son contrôle soit vue rouge. Il ne tourne que sur macOS, et aucun job de CI ne le lançait à sa fusion (`docs/method/TAURI-SHELL.md` §6).
- Preuve écartée : le gate du plafond de mémoire, car aucune fiche qu'il lit ne déclare de coquille.
- Aucune valeur de mémoire, de latence ou d'accessibilité n'existe sous Tauri (ADR-0057 §3).
- Prochaine preuve : une fiche de produit qui déclare `desktop_shell`, puis la qualification macOS de D98 sur un bundle signé.
