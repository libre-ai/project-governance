#!/bin/sh
# Pilote d'exécution réelle pour pi-evidence : lance la CLI sur des dépôts jetables et compare
# le comportement observé à l'attendu tiré de la spécification (README, messages de la CLI).
# Usage : pilote-pi-evidence.sh <copie de travail de pi-evidence>
# Sortie : une ligne par scénario « <id> attendu=<x> observé=<y> ok|ECART », code 1 si un écart.
#
# Un scénario ne vaut que s'il peut sortir en écart. L'observé de la porte est donc le couple
# « <code de sortie>:<verdict imprimé par la CLI> », jamais le code seul : un code 1 est aussi
# celui d'une CLI qui n'a pas démarré. Tenu par pilote-pi-evidence.test.ts.
#
# Ce pilote n'est PAS celui de la mesure du 2026-11-16. Écarts avec lui :
# - S1 à S3 : le pilote de la mesure comparait le seul code de sortie ; sur une copie absente,
#   S2 et S3 y sortaient « ok ».
# - S4 : il lisait tout code non nul comme un refus, et le script nommé par la recette n'existait
#   pas dans le dépôt jetable ; une CLI qui acceptait la commande avec chemin fermait quand même
#   la porte (contrôle indisponible), et le scénario sortait « ok ». Le résultat publié de la
#   couche d'exécution réelle sur le cas D05 (validation de la commande retirée) vient de là.
# - S6 : il sortait « ok » quand « verify --ci » n'avait rien exécuté.
# - Hors scénarios : le répertoire temporaire est créé directement sous TMPDIR et retiré par rm
#   (un outil propre à la machine de mesure s'en chargeait), et l'adresse factice des dépôts
#   jetables est sous un domaine réservé.
# Cette version n'a pas été rejouée sur le corpus : aucune mesure publiée ne vient d'elle.
set -u
REPO="$1"
BASE=$(mktemp -d "${TMPDIR:-/tmp}/trust-bench-pilote.XXXXXX") || exit 2
ecarts=0; joues=0
TOKEN="npm_$(printf 'A%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36)"

nouveau_depot() { # $1 nom, $2 contenu de .evidence.json, $3 (facultatif) script exécutable à créer
  d="$BASE/$1"; mkdir -p "$d"
  git -C "$d" init -q && git -C "$d" config user.name t && git -C "$d" config user.email t@example.com
  printf '%s\n' "$2" > "$d/.evidence.json"
  printf '.evidence/\n' > "$d/.gitignore"
  if [ -n "${3:-}" ]; then printf '#!/bin/sh\nexit 0\n' > "$d/$3"; chmod +x "$d/$3"; fi
  git -C "$d" add -A && git -C "$d" commit -q -m init
  printf '%s' "$d"
}
recette() { # $1 commande, $2 args JSON
  printf '{"schema_version":1,"policy":"off","checks":[{"id":"c","command":"%s","args":%s,"required":true,"timeout_seconds":30}]}' "$1" "$2"
}
porte() { # $1 dépôt → « <code de sortie de gate>:<ce que la CLI a imprimé> »
  env -i PATH="$PATH" HOME="$BASE/home" bun "$REPO/bin/evidence.ts" gate --cwd "$1" --accept-recipe --by banc >"$1.out" 2>&1
  rc=$?
  # Le verdict est celui de la ligne de synthèse du dossier ; une recette refusée n'en a pas,
  # elle a le message de refus de la commande.
  lu=$(sed -n 's/.* verdict \([A-Z][A-Z]*\) (.*/\1/p' "$1.out" | head -n 1)
  if grep -q -F 'command must be a bare executable name' "$1.out"; then lu=recette-refusee; fi
  printf '%s:%s' "$rc" "${lu:-sans-verdict}"
}
verdict() { # $1 id, $2 attendu, $3 observé
  joues=$((joues + 1))
  if [ "$2" = "$3" ]; then etat=ok; else etat=ECART; ecarts=$((ecarts + 1)); fi
  printf '%s attendu=%s observé=%s %s\n' "$1" "$2" "$3" "$etat"
}
mkdir -p "$BASE/home"

# S1 : contrôle requis qui réussit → verdict conformant, porte ouverte (0).
verdict S1-requis-vert 0:CONFORMANT "$(porte "$(nouveau_depot s1 "$(recette true '[]')")")"
# S2 : contrôle requis qui échoue → verdict failed, porte fermée (1).
verdict S2-requis-rouge 1:FAILED "$(porte "$(nouveau_depot s2 "$(recette false '[]')")")"
# S3 : contrôle requis dont l'exécutable n'existe pas → verdict incomplete, jamais conforme (1).
verdict S3-requis-indisponible 1:INCOMPLETE "$(porte "$(nouveau_depot s3 "$(recette commande-inexistante-zz '[]')")")"
# S4 : commande avec chemin → recette refusée avant toute exécution (2, message de refus).
# Le script existe et réussit : une CLI qui accepte la recette l'exécute et ouvre la porte.
verdict S4-commande-avec-chemin 2:recette-refusee "$(porte "$(nouveau_depot s4 "$(recette ./x.sh '[]')" x.sh)")"
# S5 : un jeton imprimé par un contrôle ne doit apparaître dans aucun fichier du dossier de preuves.
# Le jeton est assemblé par le contrôle lui-même : la recette (qui est consignée telle quelle) ne le contient pas.
d=$(nouveau_depot s5 "$(recette printf "[\"%s%s\",\"npm_\",\"${TOKEN#npm_}\"]")"); porte "$d" >/dev/null
fuites=$(grep -r -l -F "$TOKEN" "$d/.evidence" 2>/dev/null | wc -l | tr -d ' ')
[ -d "$d/.evidence" ] || fuites=dossier-absent
verdict S5-jeton-masque 0 "$fuites"
# S6 : la sortie de « verify --ci » ne doit pas contenir l'environnement du processus.
# Sur un dépôt sans dossier commité, la CLI répond « aucune référence à rejouer » et sort en 0 :
# sans cette réponse, rien n'a tourné et l'absence de la sentinelle ne dit rien.
d=$(nouveau_depot s6 "$(recette true '[]')")
env -i PATH="$PATH" HOME="$BASE/home" SECRET_DU_BANC=valeur-sentinelle-zz bun "$REPO/bin/evidence.ts" verify --ci --cwd "$d" >"$d.verify" 2>&1
rc=$?
if [ "$rc" -eq 0 ] && grep -q -F 'aucune référence à rejouer' "$d.verify"; then
  journalise=$(grep -c -F valeur-sentinelle-zz "$d.verify")
else
  journalise="non-exécuté(rc=$rc)"
fi
verdict S6-environnement-non-journalise 0 "$journalise"

printf 'scénarios joués=%s écarts=%s\n' "$joues" "$ecarts"
if [ "${GARDER:-0}" = 1 ]; then printf 'conservé : %s\n' "$BASE"; else rm -rf -- "$BASE"; fi
[ "$joues" -eq 6 ] || { echo "pilote : $joues scénarios joués au lieu de 6" >&2; exit 2; }
[ "$ecarts" -eq 0 ]
