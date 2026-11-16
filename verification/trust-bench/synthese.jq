# Synthèse du banc : une ligne par couche, calculée depuis les mesures brutes.
# Entrée (slurp) : toutes les lignes JSONL (déterministes + relectures), normalisées en {cas, couche, cout, attendu, rouge, illisible, ms}.
# « apport » = défauts attrapés par la couche et par aucune couche de coût strictement inférieur.
def rouges($c): map(select(.couche == $c and .rouge)) | map(.cas);
. as $m
| ($m | map(select(.attendu)) | map(.cas) | unique) as $defauts
| ($m | map(select(.attendu | not)) | map(.cas) | unique) as $sains
| ($m | map({couche, cout}) | unique | sort_by(.cout, .couche)) as $couches
| [ $couches[] as $k
    | ($m | map(select(.couche == $k.couche))) as $l
    | ($l | map(select(.attendu and .rouge) | .cas)) as $pris
    | ($m | map(select(.cout < $k.cout and .attendu and .rouge) | .cas) | unique) as $deja
    | { couche: $k.couche,
        cout: $k.cout,
        defauts_soumis: ($l | map(select(.attendu)) | length),
        defauts_attrapes: ($pris | length),
        apport_au_dela_du_moins_cher: ($pris - $deja | length),
        cas_de_l_apport: ($pris - $deja),
        sains_soumis: ($l | map(select(.attendu | not)) | length),
        faux_positifs: ($l | map(select((.attendu | not) and .rouge)) | length),
        cas_faux_positifs: ($l | map(select((.attendu | not) and .rouge) | .cas)),
        illisibles: ($l | map(select(.illisible)) | length),
        duree_totale_ms: ($l | map(.ms) | add) } ]
| { corpus: { defauts: ($defauts | length), sains: ($sains | length) },
    couches: .,
    defauts_attrapes_par_aucune_couche: ($defauts - ($m | map(select(.attendu and .rouge) | .cas) | unique)) }
