# Dayan 3D — Facturation (application Windows)

Application de bureau (Electron + Supabase + Stripe).

## 1. Lancer l'appli pour la tester

1. Installe Node.js (déjà fait).
2. Dézippe le dossier, ouvre un terminal dedans (clic droit > « Ouvrir dans le terminal »).
3. Tape :

```
npm install
npm start
```

4. Connecte-toi avec le compte créé dans Supabase (Authentication > Users).

## 2. Générer l'installateur .exe

```
npm run build
```

L'installateur apparaît dans `dist\` : « Dayan 3D Facturation Setup 1.0.0.exe ».
Installe-le sur chaque ordinateur : tous se connectent à la même base Supabase
(chacun avec son propre compte).

## 3. Utilisation

- **Clients / Produits et prestations** : à remplir avant la première facture.
- **Nouvelle facture** : choisis le client, ajoute les lignes, puis
  « Finaliser et créer le lien de paiement » : le lien Stripe et le QR sont créés,
  le PDF peut être téléchargé.
- **Statut « Payée »** : automatique, via le webhook Stripe (jamais à la main).
- **Échéance** : 30 jours fin de mois (modifiable dans le code : `dueDateFor`).

## 4. Prérequis côté serveur (déjà fournis séparément)

- `1-schema-facturation.sql` exécuté dans Supabase
- fonctions `create-payment-link` (JWT activé) et `stripe-webhook` (JWT désactivé)
- secrets `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET`

## 5. Envoi des factures par e-mail (Gmail)

À faire une fois **sur chaque ordinateur** : Paramètres > « Envoi d'e-mails ».

1. Compte Google de Dayan 3D : Sécurité > activer la validation en 2 étapes.
2. Sécurité > « Mots de passe des applications » > créer « Dayan 3D Facturation »
   (16 caractères).
3. Dans l'appli : saisir l'adresse Gmail + ce mot de passe > Enregistrer > Tester.

Le mot de passe reste sur l'ordinateur, chiffré par Windows (jamais dans la base).
Après « Finaliser », l'appli propose l'envoi ; le bouton « Envoyer par e-mail »
reste disponible sur chaque facture à payer. Le PDF est joint, le lien de paiement
est dans le message.

## 6. Droits des collaborateurs

- Collaborateur : crée et modifie clients, produits et factures ; supprime clients (sans factures),
  produits et brouillons ; modifie une facture finalisée tant qu'elle n'est pas payée
  (le lien de paiement et le QR sont alors recréés) ; envoie les e-mails.
- Une facture **payée** est verrouillée pour tout le monde (ni modification ni suppression).
- Supprimer une facture finalisée (non payée) : bouton « Supprimer » sur la facture. Le lien Stripe est désactivé,
  une trace reste dans le journal (Paramètres, visible par l'administrateur).
- Pour cela : lancer `6-suppression-factures.sql` et déployer la fonction `delete-invoice` (`5-delete-invoice.ts`, Verify JWT activé).
- Administrateur : en plus, modifie les paramètres de la société et les rôles.
- Base déjà créée ? Lance `4-mise-a-jour-droits.sql` une fois dans Supabase.
- Fonction `create-payment-link` : colle la nouvelle version (`2-create-payment-link.ts`) dans Supabase.

## 7. Apparence des factures (administrateur)

Menu « Apparence » : cases pour afficher ou masquer des blocs (QR, téléphone, site, notes, conditions,
pied de page...), textes modifiables (titre, bouton, remerciement, mode de règlement, pied de page,
conditions de règlement, mention TVA), aperçu en direct. Les réglages valent pour toutes les factures
(PDF, impression, e-mail). Pour cela : lancer `7-apparence-factures.sql` une fois dans Supabase.

## 8. Suivi des e-mails et rappels

Chaque e-mail envoyé (facture ou rappel) est noté : date, destinataire, qui l'a envoyé. Visible sur la facture
(« Envois par e-mail ») et dans la liste (colonne E-mail). Le tableau de bord montre les factures
« à relancer » (en retard) avec un bouton « Rappeler » : un message de rappel est prêt, avec le lien de paiement.
Pour cela : lancer `8-suivi-emails.sql` une fois dans Supabase.

## 9. Annulation et facture rectificative

Sur une facture « à payer » : bouton « Annuler la facture » (le lien Stripe est désactivé, la facture reste
dans la liste, marquée « Annulée », et sort du chiffre d'affaires). Une facture payée ne peut être annulée que
par l'administrateur, avec une case facultative « Rembourser aussi le client sur Stripe ».
Sur une facture annulée : « Créer une facture rectificative » = copie en brouillon à corriger, qui mentionne
« Remplace la facture … (annulée) ».
Pour cela : lancer `9-annulation-factures.sql` une fois dans Supabase et déployer la fonction `cancel-invoice`
(`9-cancel-invoice.ts`, Verify JWT activé).

## 10. Devis

Menu « Devis » : brouillon > finalisé et envoyé par e-mail (PDF joint) > accepté ou refusé.
Un devis accepté se transforme en facture (brouillon avec les mêmes lignes, liée au devis, mention
« Selon devis DE-… » sur la facture). Numéros DE-2026-0001. Validité par défaut : 30 jours, modifiable
dans Apparence. Le PDF a le même visuel que la facture, avec un cadre « Bon pour accord » à signer.
Pour cela : lancer `10-devis.sql` une fois dans Supabase (aucune nouvelle fonction serveur).

## 11. Calculateur de prix

Bouton « Calculateur de prix » dans l'éditeur de facture et de devis : prix de la pièce + supplément
(curseur de 5 à 20 CHF, boutons rapides 5 / 10 / 15 / 20, saisie libre possible), quantité, description.
Le prix par pièce = pièce + supplément. La ligne est ajoutée au document ; case facultative pour
l'enregistrer dans « Produits et prestations ». La plage du supplément (minimum, maximum, valeur de départ)
se règle dans Apparence (administrateur).

## 12. Mises à jour automatiques

L'appli installée cherche toute seule une nouvelle version au démarrage puis toutes les 4 heures, la télécharge
en arrière-plan et affiche « Redémarrer et installer ». L'adresse du serveur se règle une fois dans
Paramètres > Mises à jour (administrateur) puis s'applique à tous les ordinateurs
(lancer `11-mises-a-jour.sql` avant).

Serveur = un simple dossier web contenant 3 fichiers par version : `latest.yml`,
`Dayan3D-Facturation-Setup-X.Y.Z.exe` et son `.blockmap`. Exemple gratuit : une « release » GitHub
(dépôt public), adresse : `https://github.com/COMPTE/DEPOT/releases/latest/download`.
Supabase Storage (offre gratuite) refuse les fichiers de plus de 50 Mo : il ne convient pas à l'installateur.
Chaque nouvelle version doit avoir un numéro plus grand (1.1.0, 1.2.0, ...).

## 13. Journal d'activité (version 1.2.1)

Menu « Journal » (administrateur) : qui a fait quoi, et quand (créations, changements de statut, suppressions,
e-mails envoyés, paiements Stripe, changements de paramètres et de rôles). Pour cela : lancer `12-journal-activite.sql`.
L'adresse des mises à jour est pré-réglée (dépôt GitHub de Dayan 3D).

## 14. QR-facture suisse (version 1.3.0)

Bulletin de versement suisse (récépissé + section paiement, QR avec croix suisse) en bas de la facture, pour les
paiements par virement / e-banking, en plus du lien et du QR Stripe. Réglage : Paramètres > Société > IBAN
(IBAN suisse ou liechtensteinois, contrôlé), puis Apparence > case « QR-facture suisse ».
IBAN classique : pas de référence. QR-IBAN (délivré par la banque, IID 30000 à 31999) : référence QR de 27 chiffres
générée à partir du numéro de facture. Adresse du client : structurée (rue + numéro, NPA, localité).
Pour cela : lancer `13-qr-facture.sql` une fois dans Supabase.
Le bulletin n'apparaît pas sur un devis, une facture payée ou annulée.

## 15. Mode de paiement choisi pour chaque facture (version 1.4.0)

Sur chaque facture : « Carte en ligne (Stripe) », « QR-facture (virement) » ou « Les deux ». Le mode par défaut se règle dans
Apparence. Avec « QR-facture » seule, aucun lien Stripe n'est créé. Une facture payée par virement ou en espèces
se marque à la main (bouton « Marquer comme payée » : date et montant ; le lien Stripe est désactivé).
Pour cela : lancer `14-modes-paiement.sql`, coller la nouvelle fonction `create-payment-link` (`2-create-payment-link.ts`)
et déployer `mark-invoice-paid` (`14-mark-invoice-paid.ts`, Verify JWT activé).

## 16. Stock de matières (version 1.5.0)

Menu « Stock » : articles (filaments, bois, consommables, pièces) avec unité, quantité, seuil d'alerte et prix par unité ;
mouvements (entrée, sortie, correction d'inventaire) avec historique ; indicateurs (articles, à réapprovisionner,
valeur du stock) et carte « Stock à réapprovisionner » sur le tableau de bord.
Depuis une facture : dans le calculateur de prix, « Matière utilisée » + quantité ; à la finalisation, la matière sort
du stock toute seule (une fois). À l'annulation de la facture, une case propose de la remettre en stock.
Une modification faite après finalisation, ou une suppression, ne change pas le stock : corriger à la main.
Pour cela : lancer `15-stock.sql` une fois dans Supabase.

## 17. Dépenses et bénéfice (version 1.6.0, administrateur)

Menu « Dépenses » : saisie des dépenses (date, montant, description, fournisseur, catégorie) ; choix de la période
(ce mois, mois dernier, cette année, année dernière, tout) ; encaissé (factures payées, à la date du paiement),
dépenses, bénéfice et marge ; graphique par mois ; dépenses par catégorie. Une entrée de stock avec prix peut créer la
dépense en même temps (case cochée par défaut). Le tableau de bord montre le bénéfice du mois et de l'année.
Pour cela : lancer `16-depenses.sql` une fois dans Supabase.

## 18. Acomptes (version 1.7.0)

Sur un devis accepté : « Facture d'acompte » (pourcentage ou montant fixe, ex. 30 %) crée une vraie facture
(numéro FA-…, PDF « FACTURE D'ACOMPTE », paiement carte et/ou QR-facture comme les autres). On peut en faire plusieurs
(paiement en plusieurs fois) tant qu'il reste du montant à facturer. « Créer la facture finale » copie le devis et
déduit les acomptes déjà payés (lignes négatives « Acompte déjà versé — FA-… »). Un acompte pas encore payé n'est pas
déduit (l'appli prévient). Le devis affiche la liste des acomptes et le reste à facturer.
Pour cela : lancer `17-acomptes.sql` une fois dans Supabase.

## 19. Protection contre le double paiement (version 1.7.1)

Trois protections : (1) un lien Stripe se ferme tout seul après un paiement complété (limite à 1 paiement, ajoutée à la
création du lien) ; (2) le webhook désactive le lien dès que la facture est payée (couvre aussi les anciens liens) ;
(3) si un paiement arrive quand même pour une facture déjà payée ou annulée, la facture n'est pas modifiée, le lien est
désactivé et une alerte rouge apparaît sur le tableau de bord et dans le Journal (à rembourser dans Stripe).
Pour cela : remplacer le code des fonctions `create-payment-link` (`2-create-payment-link.ts`) et `stripe-webhook`
(`3-stripe-webhook.ts`, Verify JWT désactivé) ; le secret `STRIPE_SECRET_KEY` doit être présent (il l'est déjà).

## 20. Comptes, duplication, notifications (version 1.8.0)

- Mot de passe oublié (écran de connexion) : un code est envoyé par e-mail, puis nouveau mot de passe. Pour cela, dans Supabase
  > Authentication > Emails > « Reset Password », le modèle doit contenir `{{ .Token }}` (le code).
  Si Supabase refuse d'envoyer plus de quelques e-mails par heure : Authentication > SMTP Settings, brancher Gmail
  (smtp.gmail.com, port 465, adresse Gmail + mot de passe d'application).
- Paramètres > Mon compte : changer son mot de passe.
- Paramètres > Utilisateurs (administrateur) : « + Ajouter un collaborateur » (compte créé avec un mot de passe temporaire),
  « Mot de passe » (réinitialiser), « Désactiver / Réactiver ». Pour cela : lancer `18-utilisateurs.sql` et déployer la fonction
  `manage-users` (`18-manage-users.ts`, Verify JWT activé).
- « Dupliquer » sur une facture ou un devis : copie en brouillon (les lignes d'acompte déduit ne sont pas copiées).
- Notifications Windows quand un paiement arrive (et alerte de paiement inattendu pour l'administrateur) : l'appli vérifie chaque
  minute ; activable/désactivable dans Paramètres > Notifications Windows.

## 21. Diagnostic (version 1.9.0, administrateur)

Paramètres > Diagnostic > « Lancer le diagnostic » : vérifie, sans rien modifier, (1) la sécurité (inscriptions Supabase fermées),
(2) la base de données (chaque fichier SQL est-il installé ?), (3) les fonctions du serveur (déployées ? secrets Stripe présents ?
« Verify JWT » correct pour stripe-webhook ?), (4) cet ordinateur (Gmail, IBAN, adresse de la société, fichier latest.yml de la
dernière publication GitHub). Chaque problème indique le fichier à lancer ou l'action à faire. Bouton « Copier le rapport ».
Aucun nouveau fichier SQL ni fonction serveur.

## 22. Facturation avancée (version 2.0.0)

- Délai de paiement réglable : « fin de mois + N jours » ou « N jours nets » (Paramètres > Numérotation et délais), avec un délai
  particulier possible dans la fiche de chaque client. Le texte « Conditions de règlement » du PDF est généré automatiquement.
- Numérotation au choix : préfixe des factures et des devis, remise à zéro chaque année ou jamais, nombre de chiffres, et
  « prochain numéro » (pour continuer après d'anciennes factures).
- Remises : en pourcentage sur chaque ligne et sur le total de la facture ou du devis (colonne « Remise » et lignes
  « Sous-total / Remise » sur le PDF ; le lien Stripe tient compte des remises).
- Conditions par client : délai de paiement, remise habituelle, mode de paiement habituel (appliqués au choix du client).
- Modèles d'e-mails modifiables (Apparence) avec mots remplacés automatiquement.
Pour cela : lancer `19-facturation-avancee.sql` et remplacer le code de la fonction `create-payment-link` (`2-create-payment-link.ts`).

## 23. Pièces jointes des devis et bon de livraison (version 2.1.0)

- Devis : carte « Pièces jointes » (plans, photos, modèles 3D ; 10 Mo par fichier, 8 fichiers au plus). Les fichiers sont dans un espace
  privé de Supabase. Dans la fenêtre d'envoi du devis, des cases permettent de choisir ceux qui partent avec l'e-mail.
  Supprimer un devis supprime aussi ses fichiers. Pour cela : lancer `20-pieces-jointes.sql`.
- Facture : bouton « Bon de livraison » (date de livraison et remarque facultative) : mêmes lignes, sans les prix, avec case « Livré »
  et espace de signature du client. Aperçu, PDF et impression. Aucun fichier SQL nécessaire.

## 24. Acceptation des devis en ligne, membres et cotisations (version 2.2.0)

- Acceptation en ligne : à l'envoi d'un devis, un lien secret (code unique de 32 caractères) est ajouté au message ({acceptation}).
  Le client ouvre une page (accepter.html, hébergée sur GitHub Pages), voit son devis et clique « J'accepte » ou « Je refuse »,
  sans compte. Le devis passe en « Accepté » avec le nom saisi, et tu reçois une notification Windows. Il faut :
  (1) lancer `21-membres-et-acceptation.sql`, (2) déployer la fonction `quote-public` (`21-quote-public.ts`, « Verify JWT » DÉSACTIVÉ),
  (3) déposer `accepter.html` à la racine du dépôt GitHub et activer GitHub Pages (Settings > Pages > Deploy from a branch > main > / (root)).
  L'adresse de la page se règle dans Apparence ; le Diagnostic la contrôle.
- Membres (administrateur) : liste, fiche, cotisation par année (montant par défaut dans Paramètres > Numérotation et délais), reçu de
  cotisation en PDF numéroté (CO-…), à imprimer ou envoyer par e-mail ; indicateurs (membres actifs, cotisations payées, encaissées).

## 25. Pas encore inclus (étapes suivantes)

Devis, rappels automatiques, annulation / facture rectificative,
import depuis facture.net.
