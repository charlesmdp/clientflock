# Stripe dans Cloudflare, sans terminal

Le code utilise un paiement unique pour débloquer les deux prochaines recherches de trois clients, soit jusqu’à six prospects supplémentaires pour la recherche en cours, avec un accès de 30 jours. Les trois premiers prospects et leur recherche d’adresse email restent gratuits. Le montant vient du prix créé dans Stripe : aucun tarif n’est codé en dur.

## 1. Créer le prix dans Stripe

Dans le Dashboard Stripe, commencez en mode test. Dans le catalogue de produits, créez un produit nommé, par exemple, « ClientFlock : les 6 prochains prospects ». Ajoutez un prix **ponctuel**, fixe, dans la devise de votre choix. Copiez son identifiant `price_…`.

Le code refuse les abonnements et les tarifs variables. Il affiche le prix réel avant d’ouvrir Checkout. Les frais Stripe et la taxe éventuellement applicable à votre activité sont à prendre en compte lorsque vous choisissez votre prix. Cette première version ne calcule pas automatiquement les taxes.

## 2. Ajouter les variables d’exécution dans Cloudflare

Ouvrez **Workers & Pages → clientflock → Settings → Runtime variables and secrets**, dans l’environnement **Production**. Il s’agit de la section d’exécution située en haut, pas des variables de compilation dans Builds.

| Nom exact | Type Cloudflare | Valeur |
| --- | --- | --- |
| `STRIPE_PUBLISHABLE_KEY` | Variable | Clé publique `pk_test_…`, puis `pk_live_…` à la mise en service |
| `STRIPE_SECRET_KEY` | Secret | Clé privée `sk_test_…`, puis `sk_live_…` |
| `STRIPE_PRICE_ID` | Variable | Identifiant du prix `price_…` |
| `STRIPE_WEBHOOK_SECRET` | Secret | Signature `whsec_…` obtenue à l’étape suivante |

La clé privée et le secret de webhook restent sur le serveur. La clé publique est transmise à Stripe.js dans le navigateur, ce qui est son usage normal. Ne mettez aucune clé privée dans un fichier du dépôt, du HTML ou une variable commençant par `VITE_`.

Les clés publique et privée, le prix et le webhook doivent tous appartenir au même compte et au même mode Stripe. Enregistrez et déployez les modifications lorsque Cloudflare le propose.

## 3. Créer le webhook Stripe

Dans Stripe **Workbench → Webhooks → Ajouter une destination**, choisissez une destination HTTPS avec l’URL :

```text
https://VOTRE-DOMAINE-CLIENTFLOCK/api/billing/webhook
```

Utilisez le domaine public de votre Worker. Une URL de prévisualisation protégée par une connexion ne convient pas.

Sélectionnez ces événements :

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`
- `charge.dispute.created`

Copiez le **Signing secret** `whsec_…` dans `STRIPE_WEBHOOK_SECRET`. L’intégration REST fixe la version d’API à **2025-03-31.basil**, qui utilise le mode Checkout `embedded`. Choisissez aussi cette version pour la destination si Stripe propose ce réglage.

Le paiement s’ouvre dans la modale du site. Cette première version accepte les cartes et ne redirige pas hors de la modale. Les informations de carte vont directement à Stripe.

## 4. Vérifier avant de passer en production

Faites une recherche, ouvrez **Unlock**, vérifiez le tarif puis utilisez une carte de test Stripe, par exemple `4242 4242 4242 4242` avec une date future et un CVC de test. Dans Stripe, vérifiez que le paiement et la livraison du webhook ont réussi. Vérifiez ensuite que les prochains prospects se débloquent uniquement dans ce navigateur.

La fermeture de la modale, un paramètre d’URL ou un événement JavaScript ne débloquent jamais les prospects. Le serveur confirme le paiement auprès de Stripe. Le webhook permet aussi de confirmer le paiement quand la modale est fermée. Les répétitions de requête réutilisent la même session Checkout pour éviter des créations concurrentes.

Quand tout fonctionne, remplacez les deux clés par celles du mode live, créez le prix live et la destination webhook live, puis remplacez leurs identifiants dans Cloudflare. Une destination test et une destination live ont des signatures différentes.

## Portée de cette première version

Les droits sont liés à un cookie sécurisé du navigateur et à la recherche d’origine, pas à l’URL de résultats partagée ni au cache global. Ils persistent dans D1 pendant la fenêtre d’accès de 30 jours. La recherche d’origine est conservée au moins jusqu’à la fin de cette fenêtre. Le cookie dure un an ; effacer les cookies, utiliser la navigation privée ou changer d’appareil ne restaure pas automatiquement l’achat. Prévoir un vrai compte ou un parcours de restauration par reçu avant de vendre un accès réutilisable entre appareils. Un remboursement ou une contestation retire l’accès aux prochains résultats.

La base D1 `DB` existante est réutilisée. Les tables de paiement sont créées automatiquement au premier appel, aucune migration manuelle n’est nécessaire. Le code ne conserve ni numéro de carte ni clé Stripe dans les recherches.

## Références officielles

- [Stripe : Checkout intégré](https://docs.stripe.com/checkout/embedded/quickstart)
- [Stripe : signature des webhooks](https://docs.stripe.com/webhooks)
- [Stripe : clés API](https://docs.stripe.com/keys)
- [Stripe : tests](https://docs.stripe.com/testing)
