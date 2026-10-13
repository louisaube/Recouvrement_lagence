# Questions retenues pour v1-cerveau-recouvrement

20 questions produites ; 5 retenues pour le propriétaire ; 15 tranchées par défaut et inscrites au registre.

### 1. Q-RECOUVREMENT-01 : Droits métier de l'administrateur du socle

Situation : Un administrateur du socle, auquel aucun profil de recouvrement n'a été attribué, demande la liste des dossiers.

- **A (défaut). L'administrateur du socle ne gère que les comptes, les profils, les groupes et le journal.** Refus : sans profil Superviseur il n'accède à aucune route de recouvrement ; il lui faut un second compte portant le profil. Coût : leger.
- **B. L'administrateur du socle exerce aussi les droits du superviseur.** La liste des dossiers est rendue ; l'administrateur peut aussi importer, activer une politique et approuver des sorties comptables. Coût : leger. Questions ouvertes : les droits du service litiges et du lecteur des indicateurs sont-ils aussi ouverts à l'administrateur.

### 2. Q-RECOUVREMENT-02 : Un ou plusieurs profils par compte

Situation : L'administrateur du socle attribue le profil Superviseur à un compte, puis le profil Service litiges au même compte.

- **A (défaut). Un seul profil par compte ; la seconde attribution remplace la première.** Le compte n'est plus superviseur : il lit les litiges et se voit refuser les dossiers. Coût : leger.
- **B. Un compte peut cumuler plusieurs profils (hors compte agent).** Le compte garde les deux profils : il lit les dossiers et les litiges. Coût : lourd. Questions ouvertes : profils incompatibles avec le compte agent, écran des utilisateurs à choix multiple, règle de cumul avec la séparation des tâches.

### 3. Q-RECOUVREMENT-03 : Authentification des comptes agent

Situation : Le propriétaire met en service l'agent de la voix : son compte machine doit présenter un jeton porteur à chaque appel d'outil.

- **A (défaut). Connexion du socle (adresse et mot de passe) qui rend un jeton de 24 heures ; l'agent se reconnecte à l'expiration.** L'agent obtient son jeton par la connexion du socle et l'utilise ; au bout de 24 heures il se reconnecte. Coût : leger.
- **B. Jeton d'agent de longue durée, créé par l'administrateur, affiché une seule fois et révocable.** L'administrateur crée un jeton propre à l'agent ; la révocation le rend aussitôt inutilisable. Coût : lourd. Questions ouvertes : durée de validité, affichage unique du jeton, révocation et rotation, stockage de l'empreinte du jeton, écran de gestion des jetons.

### 4. Q-RECOUVREMENT-04 : Libération du lot du jour

Situation : Le superviseur prépare le lot du jour ; tous les contrôles passent.

- **A (défaut). Le lot est libéré aussitôt (marqué prêt) ; le superviseur n'intervient que pour un lot bloqué.** Le lot est prêt dès la préparation, sans autre action. Coût : leger.
- **B. Le lot attend la libération explicite du superviseur, même si tous les contrôles passent.** Le lot est « à libérer » ; il devient prêt quand le superviseur le libère. Coût : leger. Questions ouvertes : motif demandé ou non à la libération d'un lot sain.

### 5. Q-RECOUVREMENT-05 : Intervention humaine demandée pour une entreprise

Situation : Un agent demande une intervention humaine pour le dossier d'une entreprise, dans une conversation ouverte.

- **A (défaut). L'outil est réservé aux familles ; pour une entreprise il est refusé.** Refus ; la négociation continue, le dossier n'entre pas dans la file. Coût : leger.
- **B. L'outil est offert pour toute nature de débiteur.** La négociation est suspendue et le dossier entre dans la file du superviseur. Coût : leger.

Répondre dans l'ordre : `cuisine arbitre "?/?/?/?/?"` ou `cuisine arbitre defaut`.
