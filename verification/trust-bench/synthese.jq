# Synthèse du banc : une ligne par couche, calculée depuis les mesures brutes.
# Usage : jq --slurpfile provenance <provenance.json> -f synthese.jq <mesures.json>
# Entrée : toutes les mesures (déterministes + relectures), normalisées en
# {cas, couche, cout, attendu, rouge, illisible, ms}.
# $provenance[0].couches_derivees : les couches dérivées d'autres couches, [{couche, derivee_de}].
#
# « apport » = défauts attrapés par la couche et par aucune couche de coût strictement inférieur.
# Il ne se calcule que pour une couche qui a ses propres verdicts. Une couche dérivée combine les
# verdicts d'autres couches : tout ce qu'elle signale, l'une de ses sources le signale déjà. Contre
# ses sources, son apport vaudrait 0 quelle que soit l'entrée ; ce n'est pas une mesure, et il vaut
# donc null (« non applicable »), jamais 0. Pour la même raison, une couche dérivée ne compte pas
# parmi les couches « moins chères » des autres.
def rouges($c): map(select(.couche == $c and .rouge)) | map(.cas);
. as $m
| ($provenance[0].couches_derivees
   | if type == "array" then . else error("provenance : couches_derivees absent, déclarer [] s'il n'y en a aucune") end) as $declarees
| ($declarees | map({key: .couche, value: .derivee_de}) | from_entries) as $sources
| ($m | map(.couche) | unique) as $mesurees
| ($declarees | map(.couche, .derivee_de[]) | unique - $mesurees) as $inconnues
| if ($inconnues | length) > 0
  then error("provenance : couche(s) déclarée(s) dans couches_derivees et absente(s) des mesures : \($inconnues | join(", "))")
  else . end
| ($m | map(select(.attendu)) | map(.cas) | unique) as $defauts
| ($m | map(select(.attendu | not)) | map(.cas) | unique) as $sains
| ($m | map({couche, cout}) | unique | sort_by(.cout, .couche)) as $couches
| [ $couches[] as $k
    | ($m | map(select(.couche == $k.couche))) as $l
    | ($l | map(select(.attendu and .rouge) | .cas)) as $pris
    | ($m | map(select(.couche as $c | .cout < $k.cout and ($sources | has($c) | not) and .attendu and .rouge) | .cas) | unique) as $deja
    | ($sources | has($k.couche)) as $derivee
    | { couche: $k.couche,
        cout: $k.cout,
        derivee_de: (if $derivee then $sources[$k.couche] else null end),
        defauts_soumis: ($l | map(select(.attendu)) | length),
        defauts_attrapes: ($pris | length),
        apport_au_dela_du_moins_cher: (if $derivee then null else ($pris - $deja | length) end),
        cas_de_l_apport: (if $derivee then null else ($pris - $deja) end),
        sains_soumis: ($l | map(select(.attendu | not)) | length),
        faux_positifs: ($l | map(select((.attendu | not) and .rouge)) | length),
        cas_faux_positifs: ($l | map(select((.attendu | not) and .rouge) | .cas)),
        illisibles: ($l | map(select(.illisible)) | length),
        duree_totale_ms: ($l | map(.ms) | add) } ]
| { corpus: { defauts: ($defauts | length), sains: ($sains | length) },
    couches: .,
    defauts_attrapes_par_aucune_couche: ($defauts - ($m | map(select(.attendu and .rouge) | .cas) | unique)) }
