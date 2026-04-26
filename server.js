require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY
};
webpush.setVapidDetails(
  'mailto:votre@email.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

let subscriptions = [];
let prayerTimesCache = new Map();

// Routes
app.post('/api/subscribe', (req, res) => {
  const { subscription, location, timezone } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }

  const index = subscriptions.findIndex(sub => sub.subscription.endpoint === subscription.endpoint);
  if (index > -1) {
    subscriptions[index].location = location;
    subscriptions[index].timezone = timezone || 'UTC';
  } else {
    subscriptions.push({ subscription, location, timezone: timezone || 'UTC' });
  }
  res.json({ success: true });
});

app.post('/api/unsubscribe', (req, res) => {
  subscriptions = subscriptions.filter(item => item.subscription.endpoint !== req.body.endpoint);
  res.json({ success: true });
});

app.post('/api/test-notification', (req, res) => {
  const subscription = req.body;
  const payload = JSON.stringify({
    title: '🧪 Test SALAWATI',
    body: 'Les notifications sont opérationnelles !',
    icon: '/logo.png',
    badge: '/logo.png'
  });

  webpush.sendNotification(subscription, payload)
    .then(() => res.json({ success: true }))
    .catch(err => res.status(500).json({ error: 'Échec' }));
});

cron.schedule('0 0 * * *', () => {
  prayerTimesCache.clear();
});

// Tâche cron toutes les minutes
cron.schedule('* * * * *', async () => {
  const now = new Date();
  console.log(`[${now.toISOString()}] Vérification pour ${subscriptions.length} abonnés...`);

  for (const item of subscriptions) {
    if (!item.location || !item.timezone) continue;

    // Obtenir l'heure locale de l'utilisateur
    let nowTime;
    try {
        nowTime = new Intl.DateTimeFormat('fr-FR', {
            timeZone: item.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(now);
    } catch (e) {
        nowTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    }

    const { latitude, longitude } = item.location;
    // La clé de cache inclut la date locale de l'utilisateur
    const userLocalDate = new Intl.DateTimeFormat('fr-FR', {
        timeZone: item.timezone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(now).split('/').reverse().join('-');
    
    const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}-${userLocalDate}`;

    try {
      let timings;
      if (prayerTimesCache.has(cacheKey)) {
        timings = prayerTimesCache.get(cacheKey);
      } else {
        const [day, month, year] = userLocalDate.split('-').reverse();
        const response = await fetch(
          `https://api.aladhan.com/v1/timings/${userLocalDate}?latitude=${latitude}&longitude=${longitude}&method=2`
        );
        const data = await response.json();
        if (data && data.data) {
            timings = data.data.timings;
            prayerTimesCache.set(cacheKey, timings);
        } else continue;
      }

      const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
      for (const prayer of prayers) {
        if (timings[prayer] && timings[prayer].startsWith(nowTime)) {
          console.log(`Envoi ${prayer} à ${nowTime} pour ${item.timezone}`);
          const payload = JSON.stringify({
            title: `🕌 SALAWATI - ${prayer}`,
            body: `C'est l'heure de la prière ${prayer} (${nowTime}).`,
            icon: '/logo.png',
            badge: '/logo.png'
          });
          
          webpush.sendNotification(item.subscription, payload).catch(err => {
            if (err.statusCode === 410 || err.statusCode === 401) {
              subscriptions = subscriptions.filter(s => s.subscription.endpoint !== item.subscription.endpoint);
            }
          });
        }
      }
    } catch (err) {
      console.error('Erreur CRON:', err);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));