# v1 : moteur de recouvrement MicroStars, cerveau déterministe et outils des agents

Source : « Moteur de recouvrement agentique : spécifications », version 0.1 du 13/10/2026 (Louis Aubé), et arbitrages du propriétaire du même jour. Cette version couvre le jalon 1 de la spécification et les outils par lesquels les agents interrogent le cerveau. Aucun message réel n'est envoyé, aucun modèle de langage n'est appelé, aucun outil comptable n'est lu ni écrit directement.

## Besoin
MicroStars recouvre ses créances sur deux publics : les familles (particuliers) et les entreprises. Un cerveau unique, déterministe et auditable fixe, pour chaque dossier, la stratégie et les limites de négociation. Les agents de canal (voix, courriel et SMS, courrier, fabriqués dans des versions ultérieures) conversent dans ces limites sans jamais fixer une condition : ils lisent le dossier, demandent l'offre suivante contre une contrepartie, inscrivent un engagement, une contestation ou une réclamation. Ils n'ont aucune autorité propre.

Critère de la politique : l'encaissement net à l'horizon fixé, coût des actions déduit. Dans cette version, ce critère est porté par les seuils de la politique et n'est jamais calculé. Aucune probabilité, aucun taux, aucun montant ne vient d'ailleurs que d'un fichier importé ou de la politique en vigueur ; aucune valeur métier n'est écrite dans le code.

La boucle avec la comptabilité est fermée : toute condition accordée qui change un solde produit une sortie comptable, suivie jusqu'à ce que l'import suivant la constate.

## Dossier
Un dossier regroupe les factures et avoirs ouverts d'un même débiteur. Le montant négociable est la somme des soldes de ses factures non gelées et non prescrites. Une facture en litige est gelée ; une contestation exprimée dans une conversation arrête la négociation de tout le dossier.

Débiteur : identifiant client du logiciel de facturation, nature (famille ou entreprise), SIREN obligatoire pour une entreprise et absent pour une famille. Chaque facture porte l'entité créancière qui l'a émise (SIREN), le réseau comptant plusieurs sociétés.

États : ouvert, en négociation, engagé, gelé, en file du superviseur, transféré à l'étape suivante, soldé. Le référentiel des états et des transitions permises est un livrable de la version ; chaque transition est journalisée.

## Profils et droits
Connexion par les comptes du socle ; l'administrateur du socle crée les comptes et attribue les profils. Masquer un bouton ne suffit pas : chaque restriction est vérifiée par le serveur et par la base, à chaque requête.
- **Superviseur** : charge les fichiers, lit le rapport d'import et donne le feu vert ; importe et active les versions de politique ; prépare le lot du jour ; approuve les sorties comptables ; tranche la file de décisions ; relit l'échantillon hebdomadaire ; voit les dossiers, le journal et les indicateurs. Ne négocie aucun dossier courant.
- **Compte agent** : compte machine, un par canal (voix, courriel et SMS, courrier), authentifié par jeton porteur. N'accède qu'aux outils des agents, et seulement pour les dossiers ouverts à son canal. Ne voit jamais la politique, le plancher, les offres non débloquées, le segment, le journal ni les autres dossiers.
- **Service litiges** : voit les factures en litige, les contestations et les dossiers concernés ; ouvre et clôt un litige, ce qui gèle ou dégèle la facture. Rien d'autre.
- **Lecteur des indicateurs** : indicateurs agrégés seulement ; aucun dossier, aucune donnée nominative.

## Fichiers d'entrée
Les fichiers suivent un format pivot, indépendant de l'outil d'origine : les connecteurs des versions suivantes produiront ce même format. Chaque fichier passe par l'import du socle (aperçu, erreurs, confirmation) ; la confirmation par le superviseur vaut feu vert. Chaque import produit un rapport d'écarts avec le précédent du même type : dossiers nouveaux, soldés, modifiés. Les fichiers Créances et Paiements sont refusés en entier dès la première erreur, faute de quoi une facture ou un avoir écarté fausserait un solde.

| Fichier | Contenu minimal | Contrôle bloquant |
|---|---|---|
| Créances | photographie complète du portefeuille à une date d'extraction : pièce (facture ou avoir, numéro), entité créancière, débiteur, payeur, montant, solde, date de facture, échéance, segment, canaux autorisés | numéro en double ; total des soldes différent du total de contrôle saisi par le superviseur à l'import, soit le solde du compte clients à la date d'extraction |
| Paiements | relevé bancaire : référence, montant, date ; date du relevé | relevé plus ancien que la fraîcheur maximale de la politique : aucune offre ni aucun ordre d'envoi tant qu'un relevé frais n'est pas confirmé |
| Litiges | facture, motif, responsable, date d'ouverture | toute facture en litige gelée |
| Interlocuteurs | débiteur, rôle (entreprise : comptabilité fournisseurs, acheteur, valideur ; famille : payeur), courriel, téléphone, adresse postale | coordonnée de format invalide : canal suspendu pour cet interlocuteur |
| Pièces | index par facture (contrat, commande, preuve de livraison), sans les documents | pièce exigée par la politique absente : relance bloquée |
| Politique | voir la section Politique | contrôles d'activation |

Lettrage : seuls les paiements datés après la date d'extraction des créances sont appliqués, les autres figurant déjà dans les soldes. Ordre d'affectation : la référence contient le numéro d'une seule facture ouverte ; sinon le montant égale le solde d'une seule facture ouverte du portefeuille ; sinon le paiement est non affecté. Un paiement non affecté entre dans la file de décisions et gèle les dossiers dont une facture ou le solde total égale son montant, jusqu'à son affectation par le superviseur. Un excédent sur une facture est traité comme un paiement non affecté.

## Sorties comptables
Une décision qui modifie un solde produit une sortie comptable : avoir de remise quand un engagement assorti d'une remise est tenu ; passage en perte décidé par le superviseur. Chaque sortie porte l'entité créancière, le débiteur, les factures, le montant, le motif administratif et un identifiant stable. États : à approuver, approuvée, constatée, en écart. Le superviseur approuve par lot ; les sorties approuvées sont exportées dans un fichier au format pivot, à saisir dans l'outil comptable. Une sortie est constatée quand un import de créances ultérieur la reflète (avoir présent ou solde réduit d'autant) ; non constatée après le nombre d'imports fixé par la politique, elle passe en écart et entre dans la file. Tant qu'une sortie approuvée n'est pas constatée, le montant négociable en tient compte et aucune relance ne porte sur la part qu'elle couvre.

## Politique
Version datée, importée et activée par un superviseur identifié ; l'empreinte du fichier est conservée ; une version active n'est jamais modifiée, une nouvelle la remplace. Format : décision JDM de GoRules ZEN, évaluée par `@gorules/zen-engine`, accompagnée de ses paramètres et de ses dossiers témoins.

Elle fixe, par segment et nature de débiteur : l'horizon ; l'étape suivante (recouvreur externe, contentieux, cession) et sa valeur attendue, qui fait le plancher ; l'échelle d'offres ; la contrepartie exigée par chaque concession ; la durée maximale d'un échéancier ; le seuil de montant au-delà duquel le dossier revient au superviseur ; les pièces exigées ; la fraîcheur maximale du relevé ; les plafonds d'encours sous échéancier ; la taille de l'échantillon de relecture ; le délai de prescription, son point de départ et son délai d'alerte ; l'action du jour selon l'état et le retard (aucune, relance par canal, proposition, transfert proposé).

Contrôles d'activation, tous bloquants :
- aucune offre sous le plancher de son segment ;
- concessions décroissantes : l'écart entre deux offres successives diminue ;
- chaque concession porte une contrepartie : date ferme, premier versement ou prélèvement ;
- aucun échéancier au-delà de la durée maximale ; pour une famille, aucun frais ni intérêt sur un délai ;
- chaque segment présent dans les créances confirmées a une règle ;
- les dossiers témoins de la version donnent exactement les décisions attendues.

## Négociation
- Ancrage : la première offre rendue est la première de l'échelle, chiffrée par le cerveau.
- L'agent descend l'échelle une offre à la fois, chaque concession contre sa contrepartie, sans jamais en sortir. Échelle épuisée : l'outil répond qu'aucune autre offre n'existe et le dossier entre dans la file du superviseur.
- Échéanciers courts : durée maximale fixée par la politique.
- Engagement précis : montant, date, moyen de paiement, échéances le cas échéant. Il reproduit exactement une offre débloquée, sinon il est refusé. La réponse rend les chiffres que l'agent répète au débiteur ; le cerveau émet la confirmation écrite.
- Engagement tenu : les paiements affectés atteignent le montant au plus tard à la date promise. Engagement rompu (versement manqué à sa date) : déchéance, les concessions de l'engagement tombent et le dossier revient à l'action fixée par la politique.
- Contestation : arrêt de la négociation, création d'un litige pour le service litiges, gel des factures visées.
- Le motif interne (règle, version, montants de référence) reste au journal ; l'agent et le débiteur ne reçoivent que des conditions.

## Outils des agents
Mêmes opérations et mêmes contrôles sur deux transports : une API REST et un serveur MCP (HTTP en flux, SDK TypeScript officiel du protocole), le second n'étant qu'une enveloppe du premier. Chaque appel porte le compte agent, la version d'agent, le canal, l'identifiant de conversation et une clé d'idempotence ; il est journalisé avec ses entrées et sa réponse. Un appel rejoué avec la même clé rend la même réponse sans nouvel effet. La recette joue l'agent par ces outils, sur les deux transports.
1. **Lire le dossier** : interlocuteurs joignables sur le canal, factures non gelées et soldes, montant négociable, offre en cours, engagements, actions permises.
2. **Ouvrir une conversation** : exige la déclaration que l'interlocuteur a été informé qu'il parle à une IA ; sans elle, aucun autre outil n'est accessible dans cette conversation.
3. **Demander l'offre suivante**, avec la contrepartie proposée.
4. **Inscrire un engagement.**
5. **Signaler une contestation.**
6. **Demander une intervention humaine** (familles) : négociation suspendue, dossier dans la file du superviseur.
7. **Signaler une réclamation.**
8. **Vérifier un message avant envoi** : chaque montant et chaque date du texte appartiennent aux conditions débloquées du dossier, et le texte ne contient aucun terme interne (plancher, règle, version, segment) ; sinon refus motivé.

## Garde-fous
Une erreur d'agent se répète sur des milliers de dossiers : les garde-fous agissent avant l'envoi.
- **Lot du jour** : le superviseur en déclenche la préparation ; le cerveau décide l'action de chaque dossier et produit des ordres d'envoi structurés (dossier, interlocuteur, canal, conditions), sans texte. Le lot est libéré quand tous ses contrôles passent ; libéré, il est seulement marqué prêt, aucun envoi n'existant dans cette version. Un lot bloqué ne se libère que par décision du superviseur.
- **Confirmation écrite d'un engagement** : hors lot, émise immédiatement, soumise aux mêmes contrôles unitaires.
- **Arrêt automatique** : la part d'un type de décision dans le lot s'écarte de sa moyenne de plus de trois écarts-types, calculés sur les 20 derniers lots et à partir de 10 lots ; avant, plafond fixe par type de décision, fixé par la politique. Le lot est bloqué et une alerte entre dans la file.
- **Plafond d'encours sous échéancier**, par version d'agent et par segment : atteint, aucune offre avec échéancier n'est plus rendue et une alerte entre dans la file.
- **Dossiers témoins** rejoués à chaque lot ; un écart bloque le lot. Ils ne produisent jamais d'ordre libérable.
- **Aucun envoi en double** : un seul ordre par dossier, type et jour, garanti par la base.
- **Familles** : un transfert à l'étape suivante n'est jamais exécuté par le cerveau ; il est proposé dans la file et décidé par le superviseur.
- **Prescription** : une facture dont le délai de prescription de la politique est échu sort du montant négociable et entre dans la file ; à l'approche de l'échéance (délai d'alerte de la politique), une alerte entre dans la file avec l'étape suivante proposée.

## File de décisions, relecture, journal
- File du superviseur : contestations, montants au-delà du seuil, échelles épuisées, paiements non affectés, sorties comptables en écart, prescriptions proches ou échues, alertes, demandes d'intervention humaine, transferts proposés. Chaque décision du superviseur est motivée et journalisée.
- Relecture hebdomadaire : le cerveau tire l'échantillon au sort (taille fixée par la politique, tirage reproductible) ; le superviseur voit les entrées du dossier telles qu'au moment de la décision, sans la décision du cerveau, et donne la sienne ; l'écart alimente l'indicateur d'erreurs.
- Chaque décision du cerveau journalise ses entrées complètes, la version de politique, la règle appliquée et la probabilité de la décision (1 tant que la table est déterministe), afin que les politiques apprises puissent être évaluées sur l'historique.

## Indicateurs
Chacun en deux termes, sans note agrégée, par segment, version de politique et version d'agent : encaissé / dû à l'horizon ; engagements tenus / pris ; remises accordées / dû ; réclamations / actions ; erreurs / décisions relues.

## Écrans
- Imports : les six fichiers, aperçu, erreurs, rapport d'écarts, feu vert.
- Politique : versions, contrôles d'activation, témoins, activation.
- Lot du jour : préparation, contrôles, blocages, libération.
- Sorties comptables : à approuver, approuvées, constatées, en écart ; approbation par lot ; export.
- File de décisions.
- Dossiers : liste et fiche (état, factures, gels, offres débloquées, engagements, sorties comptables, décisions avec leur motif interne).
- Litiges.
- Relecture.
- Indicateurs.
- Journal (celui du socle).

## Conformité
À valider par un conseil externe avant tout envoi réel : annonce de l'IA à l'interlocuteur (AI Act, art. 50) ; intervention humaine possible sur les décisions importantes pour les familles (RGPD, art. 22) ; aucun délai facturé à une famille sans examen du droit du crédit à la consommation.

## Hors demande
Lecture ou écriture directe dans les outils comptables et de paiement (version 2) ; envoi réel (courriel, SMS, appel, courrier) et appel à un modèle de langage (version 3) ; injonction de payer (version 4) ; fiche des conseillers ; courbes de survie et calcul du gain ; politique apprise ; tirage des 5 % de dossiers ; ordonnancement automatique du lot ; stockage des pièces ; pénalités et indemnités de retard ; éditeur de politique.
