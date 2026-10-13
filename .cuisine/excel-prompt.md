Tu prépares, pour la cuisine logicielle, la DEMANDE DE VERSION qui transformera un classeur Excel métier en application. Tu n'écris aucun code.

Entrées, en lecture seule :
- l'analyse fine du classeur : `{{RAPPORT}}` (synthèse) et `{{CARTE}}` (détail JSON : plan en blocs, graphe, libellés, effets mesurés, sélecteurs, anomalies, manifeste) ;
- `CLAUDE.md` et le dossier `specifications/` pour savoir ce que l'application fait déjà.

Écris en français, dans `{{SORTIE}}`, une demande que l'humain relira avant de lancer la fabrication, avec ces rubriques :
1. **Objet** : à quoi sert le classeur, en deux phrases.
2. **Saisies** : chaque hypothèse ou donnée saisie qui pèse sur les sorties (libellé, unité, valeur actuelle, cellule source), regroupées en objets métier ; un sélecteur devient une liste de choix avec ses valeurs.
3. **Calculs** : chaque bloc de formules qui mène aux sorties, en règle lisible, avec sa provenance `(excel: Feuille!Cellule)`. Pas de formule Excel recopiée : la règle métier qu'elle exprime.
4. **Restitutions** : les sorties décisionnelles et les contrôles du classeur, à reproduire comme écrans ou indicateurs ; chaque contrôle devient une règle vérifiable.
5. **Droits** : qui saisit, qui consulte, qui valide. Le classeur ne le dit pas : écris `[À PRÉCISER PAR L'HUMAIN]` et propose une hypothèse prudente, étiquetée `(inferred)`.
6. **Anomalies du classeur à trancher avant fabrication** : chaque anomalie critique ou majeure du registre (valeur saisie en dur, clé en doublon, somme décalée, cache périmé...) avec sa cellule et une question fermée. Ne jamais reproduire une anomalie en silence dans l'application.
7. **Exclusions** : ce que cette version ne fait pas (import des historiques, exports, etc., sauf si l'humain l'a demandé).

Reste fidèle au classeur : n'invente ni écran ni règle qu'il ne contient pas, hors rubrique 5. Termine par la liste des points marqués `[À PRÉCISER PAR L'HUMAIN]`.
