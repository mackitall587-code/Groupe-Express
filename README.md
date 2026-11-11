# GROUPE EXPRESS V18.6.9 — PWA client + administration externe

Deux espaces PWA (client et administration) partagent le même serveur Node.js et la même base SQLite.

## Installation sous Windows
1. Installer Node.js **22.13 ou supérieur**.
2. Extraire le ZIP.
3. Dans `ge_work`, copier `.env.example` vers `.env`.
4. Renseigner `ADMIN_PHONE` et `ADMIN_PASSWORD` (8 caractères minimum).
5. Ouvrir PowerShell dans `ge_work`, puis lancer `npm start`.
6. Ouvrir le site client : `http://localhost:3000/`.
7. Ouvrir l'administration séparée : `http://localhost:3000/admin-panel/`.
8. Lancer les tests : `npm test`.

## Fonctions synchronisées

### Côté client
- Menu, recherche, fiches détaillées, panier, commandes et suivi.
- Profil, historique, notifications, cadeaux et fidélité.
- **Boutique électronique** : accès illustré, bannière animée gérée depuis l’administration, catégories avec pages dédiées, fiches produit multi-angles, variantes de couleurs, panier multi-articles et commandes synchronisées avec l’administration.
- Suppression contrôlée des produits, images, plats, promotions, cadeaux et comptes clients.
- Prévention des notifications de retrait répétées et compatibilité avec l’absence du fichier `data/menu.json` après initialisation.
- **Avis clients** : dépôt d'un avis depuis le site ; seuls les avis approuvés par l'administration sont publiés.
- **Inviter un ami** : partage natif lorsqu'il est disponible, ouverture du partage WhatsApp sinon, et copie du lien avec solution de secours.

### Administration
- Gestion des commandes, plats, stocks, catégories, clients, promotions et photos.
- Suppression des plats, catégories, produits électroniques, avis, cadeaux, images et fournisseurs avec confirmation.
- Boutique électronique : création et suppression des produits, consultation et mise à jour des demandes client.
- Avis : publier, refuser ou supprimer.
- Messages : envoi ciblé ou à tous les clients ; **Message de retrait** réservé aux commandes au statut « Prête ».
- Fournisseurs : création, modification, activation/désactivation, suppression et association des plats. La liste d'association n'affiche que les plats actifs. Un plat ne peut être associé qu'à un seul fournisseur.
- ExpressSend : transmission des plats au WhatsApp du fournisseur pour les commandes du site, les commandes WhatsApp entrantes et les commandes saisies dans l'administration.

## Configuration WhatsApp ExpressSend
Pour l'envoi réel, créer/configurer une application Meta WhatsApp Business Cloud API, puis renseigner dans `.env` :
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_API_VERSION`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

Configurer ensuite le webhook Meta vers `https://VOTRE-DOMAINE/api/whatsapp/webhook` et abonner l'événement `messages`. Sans jeton d'accès et identifiant de numéro, les transmissions sont enregistrées comme en attente mais aucun WhatsApp n'est envoyé. Les règles et modèles de conversation de Meta peuvent s'appliquer.

Dans l'administration > Fournisseurs, activer ExpressSend, cocher l'option d'inclusion du téléphone client si souhaité, enregistrer, puis associer les plats actifs à leurs fournisseurs. Les fournisseurs inactifs ne reçoivent pas de commandes.

## Autres paramètres
- `ADMIN_PHONE` et `ADMIN_PASSWORD` : compte de l'équipe.
- `OPENAI_API_KEY` : active les réponses de l'assistant IA et les propositions d'approvisionnement.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` : notifications push ; le navigateur doit aussi obtenir le consentement du client.
- `PORT` : port du serveur (3000 par défaut).
- `DB_PATH` : chemin de la base SQLite persistante en production.
- `PICKUP_POINTS` : points de retrait séparés par `|`.

## Déploiement
Pour rendre le site accessible sur les téléphones hors du réseau local, déployer Node.js sur un hébergement avec HTTPS et stockage persistant. Définir `NODE_ENV=production`, protéger les secrets du fichier `.env` et sauvegarder régulièrement la base. Ne jamais publier le contenu de `.env`.

## Vérifications effectuées sur cette archive
- `node --check` sur les scripts serveur et client.
- `npm test` : **81 tests réussis, 0 échoué**.
- Démarrage du serveur contrôlé sur port de test et page d'accueil HTTP 200.
- L'envoi WhatsApp réel n'est pas testable sans identifiants Meta valides ; le test automatise la réception webhook et l'enregistrement des transmissions.

## Version 18.6.1 — améliorations e-commerce et installation PWA

- Bannière d’accueil : images en plein cadre, visibilité renforcée et adaptation mobile.
- Profil client : corrections des éléments masqués et alignement des compteurs.
- Boutique électronique : catégories, mise en avant, grille responsive, page de détail produit, agrandissement photo, quantité et passage de commande direct.
- Administration électronique : ajout, modification via formulaire, remplacement de photo, publication/masquage, gestion de stock et traitement des commandes, synchronisés à la boutique client.
- Annulation d’une commande électronique non terminée : restitution du stock.
- Guide automatique d’installation PWA pour les nouveaux visiteurs avec étapes illustrées Android et iPhone; guide accessible depuis le profil.
- Avis clients : le workflow de soumission/modération/publication est testé de bout en bout.
- Politique de confidentialité enrichie; retrait de la phrase de note éditoriale demandée.

Validation : `node scripts/smoke-test.js` — 88 tests réussis, 0 échec. Les interfaces responsive ont aussi fait l’objet d’une vérification de maquettes rendues aux formats mobile.


## Version 18.6.9

Correctifs supplémentaires : suppression JSON conforme au serveur, correction du conteneur des bannières électroniques, gestion autonome des catégories et icônes, dédoublonnage des galeries, conservation des URL de photos en édition, panier avec variante et stock, notifications limitées aux messages de bienvenue et de l’équipe, notes calculées à partir des avis réels par produit. Tests automatisés : `npm test` — 117 réussis, 0 échoué.


## Version 18.6.9

Gestion des plats réorganisée en deux espaces distincts : ajout de plat et catalogue/inventaire. Les catégories de plats disposent désormais d'une création indépendante avec icône photo, modification de l'icône et synchronisation sur l'accueil client. La suppression d'une catégorie demande une confirmation renforcée et supprime ses plats associés dans une transaction SQLite. Vérification automatisée : 134 tests réussis.


## Version 18.7.0 — Notifications et fidélité

### Générer les clés Web Push
1. Exécuter `npm install`.
2. Exécuter `npm run vapid:generate`.
3. Copier `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` dans le fichier `.env` du serveur.
4. Redémarrer le serveur en HTTPS. Les clients se connectent, ouvrent Profil ou Notifications, puis choisissent « Activer les notifications ». Sur iPhone, installer d’abord la PWA sur l’écran d’accueil et l’ouvrir depuis son icône.

### Assistant IA
Renseigner `OPENAI_API_KEY` dans `.env`, puis redémarrer le serveur. Ne jamais mettre cette clé dans le code client.

### WhatsApp Cloud API
Renseigner les identifiants Meta Business dans `.env` et enregistrer `/api/whatsapp/webhook` comme webhook HTTPS. L’activation réelle exige le numéro WhatsApp Business, le jeton d’accès et les autorisations Meta valides.

### Notifications automatiques
Les nouveaux plats et produits créent un message dans l’application pour chaque compte client existant. Une notification système Web Push est envoyée aux clients ayant autorisé les alertes et lorsque les clés VAPID sont configurées. La récompense fidélité est créée après cinq commandes marquées « retirées » dans une fenêtre glissante de sept jours.
