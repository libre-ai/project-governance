# HAR-02 — Session confinée

## Contexte

ADR-0018 D2 ouvre une première capacité : un processus local confiné par le harnais, sans réseau ni secret, qui rend une attestation signée. ADR-0042 §3 interdit à la fabrique tout agent réel avant la qualification du confinement. `ai-work-supervision` ouvre un terminal neuf par exécution, avec un environnement vidé et un journal à empreinte glissante. `execution-sandbox` lie l'identité d'une exécution à son attestation. Les sessions d'agent du propriétaire tournent sous le bac à sable de son harnais, hors flotte.

## Ce que la brique ferme

- Une session d'agent qui démarre sans identité de mission ni zone déclarée, contraire à I-18.
- L'héritage par l'agent de l'environnement de l'hôte.
- Une session qui installe un outil d'agent en cours de travail, ce qu'I-38 réserve à une demande du propriétaire.

## Ce qu'elle ne fait pas

- Elle n'isole ni le système de fichiers ni le réseau : le confinement relève de EXE-01.
- Elle n'émet pas le jeton de la session, qui vient de IDN-02 et de IDN-04.
- Elle ne lance aucun agent réel : la garde de qualification n'admet que le faux agent.

## Mesure

Preuves citées : le module de session de `ai-work-supervision` et le module d'exécution attestée de `execution-sandbox`. Le premier montre l'environnement réduit à une liste fermée et le journal. Le second lie l'identité à l'attestation, et refuse encore avant de lancer un worker, faute de savoir appliquer le mode réseau du contrat.

Prochaine preuve : une mission entière conduite sous confinement déclaré, avec jeton atténué et attestation vérifiée.
