# Sunu Écran : base de données + paiement

1. Créez un compte marchand sur paytech.sn (Wave, Orange Money et carte dans une seule intégration). Récupérez API_KEY et API_SECRET.
2. Copiez `.env.example` en `.env` et remplissez-le. `BASE_URL` = l'adresse publique HTTPS de votre site (PayTech doit pouvoir appeler `/api/ipn`).
3. `npm install` puis `npm start`. Hébergez sur un serveur Node (Render, Railway, VPS).
4. Testez avec `PAYTECH_ENV=test`, puis passez à `prod` quand PayTech valide votre compte.

La base SQLite `sunu.db` se crée toute seule (commandes + codes d'accès). Sauvegardez-la régulièrement.
