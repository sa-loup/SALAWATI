require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static('public')); // les fichiers frontend

// Clés VAPID (générées une fois avec web-push generate-vapid-keys)
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY
};
webpush.setVapidDetails(
  'mailto:votre@email.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Stockage en mémoire des abonnements (à remplacer par une BDD en production)
let subscriptions = [];

// Routes
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscriptions.some(sub => sub.endpoint === subscription.endpoint)) {
    subscriptions.push(subscription);
  }
  res.json({ success: true });
});

app.post('/api/unsubscribe', (req, res) => {
  subscriptions = subscriptions.filter(sub => sub.endpoint !== req.body.endpoint);
  res.json({ success: true });
});

// Route pour tester manuellement une notification push
app.post('/api/test-notification', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }

  const payload = JSON.stringify({
    title: '🧪 Test de notification',
    body: 'Si vous voyez ceci, les notifications fonctionnent !',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [200, 100, 200],
    tag: 'test-notif'
  });

  webpush.sendNotification(subscription, payload)
    .then(() => res.json({ success: true }))
    .catch(err => {
      console.error('Erreur lors de l\'envoi du test', err);
      res.status(500).json({ error: 'Échec de l\'envoi' });
    });
});

// Tâche cron : vérifier les horaires toutes les minutes
cron.schedule('* * * * *', async () => {
  console.log('Vérification des temps de prière...');
  // Récupération des horaires (exemple pour un lieu fixe, en pratique il faut stocker les coordonnées des utilisateurs)
  const latitude = 48.8566; // Paris par défaut
  const longitude = 2.3522;
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  try {
    const response = await fetch(
      `https://api.aladhan.com/v1/timings/${day}-${month}-${year}?latitude=${latitude}&longitude=${longitude}&method=2`
    );
    const data = await response.json();
    const timings = data.data.timings;
    
    const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    const nowTime = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
    
    prayers.forEach(prayer => {
      if (timings[prayer] && timings[prayer].startsWith(nowTime)) {
        // C'est l'heure de cette prière, envoyer la notification
        const payload = JSON.stringify({
          title: '🕌 Temps de Salat',
          body: `C'est l'heure de la prière ${prayer} !`
        });
        subscriptions.forEach(sub => {
          webpush.sendNotification(sub, payload).catch(err => {
            // Supprimer l'abonnement invalide
            subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
          });
        });
      }
    });
  } catch (err) {
    console.error('Erreur lors de la vérification des horaires', err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));