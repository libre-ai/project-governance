# HAR-02 — Session confinée

## Contexte

ADR-0018 D2 ouvre une première capacité : un processus local confiné par le harnais, sans réseau ni secret, qui rend une attestation signée. ADR-0042 §3 interdit à la fabrique tout agent réel avant la qualification du confinement. `ai-work-supervision` ouvre un terminal neuf par exécution, avec un environnement vidé et un journal à empreinte glissante. `execution-sandbox` lie l'identité d'une exécution à son attestation.

## Ce que la brique ferme

- Une session d'agent qui démarre sans identité : I-18 demande une identité d'agent liée à une flotte, une mission et des capacités.
- L'héritage par l'agent de l'environnement de l'hôte.
- Une session qui installe un outil d'agent en cours de travail : I-38 réserve toute installation live à une demande explicite du propriétaire.

## Ce qu'elle ne fait pas

- Elle n'isole ni le système de fichiers ni le réseau. Sans EXE-01, elle n'a pas de zone de confinement à porter.
- Elle n'émet pas le jeton de la session. Sans IDN-04, elle n'a pas d'identité d'agent ; sans IDN-02, pas de jeton atténué à lui remettre.
- Elle ne lance aucun agent réel : au commit lu, le domaine de `ai-work-supervision` n'admet que le profil du faux agent.

## Mesure

Preuves citées : le module de session de `ai-work-supervision` et le module d'exécution attestée de `execution-sandbox`. Le premier montre l'environnement réduit à une liste fermée et le journal. Le second lie l'identité à l'attestation, et refuse encore avant de lancer un worker, faute de savoir appliquer le mode réseau du contrat. Aucun des deux ne montre un objet qui refuse de démarrer sans identité, zone et journal. Aucun n'exerce I-38.

Prochaine preuve : une mission entière conduite sous confinement déclaré, avec jeton atténué et attestation vérifiée.
