const VAPID_PUBLIC_KEY = 'BFQNEuBss38kFFgrmlZCnhKE68VGD31KLlUPQketiFTTTP7epECVZpSJjXLYxPzekRYpic9Tkr7MuuLuX3t4obM';  // Remplacer

let currentCoords = null;
let timings = {};
let notificationSubscription = null;
let timerInterval;

// Éléments DOM
const timesCard = document.getElementById('times-card');
const timesGrid = document.getElementById('times-grid');
const currentTimeEl = document.getElementById('current-time');
const nextPrayerName = document.getElementById('next-prayer-name');
const countdownEl = document.getElementById('countdown');
const progressFill = document.getElementById('progress-fill');
const locationNameEl = document.getElementById('location-name');
const enableBtn = document.getElementById('enable-notifications');
const notifText = document.getElementById('notif-text');
const statusText = document.getElementById('notification-status');
const testBtn = document.getElementById('test-notification');

// ----- 1. Géolocalisation & reverse geocoding (nom de la ville) -----
function initGeolocation() {
  if (!navigator.geolocation) {
    locationNameEl.textContent = 'Géolocalisation non supportée';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      currentCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      // Tenter d'obtenir le nom de la ville via reverse geocoding (API Nominatim gratuite)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${currentCoords.latitude}&lon=${currentCoords.longitude}`
        );
        const data = await res.json();
        const city = data.address.city || data.address.town || data.address.village || 'Votre position';
        locationNameEl.textContent = `📍 ${city}`;
      } catch {
        locationNameEl.textContent = `📍 Lat ${currentCoords.latitude.toFixed(2)}, Lon ${currentCoords.longitude.toFixed(2)}`;
      }
      fetchPrayerTimes();
    },
    () => locationNameEl.textContent = 'Accès à la position refusé'
  );
}

// ----- 2. Récupération des horaires (API Aladhan) -----
async function fetchPrayerTimes() {
  if (!currentCoords) return;
  const { latitude, longitude } = currentCoords;
  const today = new Date();
  const day = today.getDate();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  const url = `https://api.aladhan.com/v1/timings/${day}-${month}-${year}?latitude=${latitude}&longitude=${longitude}&method=2`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    timings = data.data.timings;
    updateUI();
  } catch (err) {
    timesCard.classList.remove('hidden');
    timesGrid.innerHTML = '<p>Impossible de charger les horaires.</p>';
  }
}

// ----- 3. Affichage et mise à jour dynamique -----
function updateUI() {
  timesCard.classList.remove('hidden');
  drawPrayerTimes();
  startLiveUpdates();
}

function parseTime(timeStr) {
  const cleaned = timeStr.replace(' (IST)', '').trim();
  const [h, m] = cleaned.split(':').map(Number);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
}

function drawPrayerTimes() {
  const prayers = [
    { key: 'Fajr', name: 'Fajr' },
    { key: 'Sunrise', name: 'Lever' },
    { key: 'Dhuhr', name: 'Dhuhr' },
    { key: 'Asr', name: 'Asr' },
    { key: 'Maghrib', name: 'Maghrib' },
    { key: 'Isha', name: 'Isha' }
  ];

  const now = new Date();
  let nextPrayerKey = null;
  let minDiff = Infinity;

  prayers.forEach(p => {
    const time = timings[p.key];
    if (!time) return;
    const prayerDate = parseTime(time);
    const diff = prayerDate - now;
    if (diff > 0 && diff < minDiff) {
      minDiff = diff;
      nextPrayerKey = p.key;
    }
  });

  let html = '';
  prayers.forEach(p => {
    const time = timings[p.key];
    if (!time) return;
    const isNext = p.key === nextPrayerKey;
    html += `<div class="time-row${isNext ? ' next-prayer' : ''}">
      <span>${p.name}</span>
      <span>${time}</span>
    </div>`;
  });
  timesGrid.innerHTML = html;

  if (nextPrayerKey) {
    nextPrayerName.textContent = nextPrayerKey;
    // Mise à jour du compte à rebours
    updateCountdown(parseTime(timings[nextPrayerKey]));
  } else {
    nextPrayerName.textContent = '—';
    countdownEl.textContent = '—';
  }
}

function updateCountdown(targetDate) {
  const diff = targetDate - new Date();
  if (diff <= 0) {
    countdownEl.textContent = 'Maintenant';
    progressFill.style.width = '100%';
    return;
  }
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  countdownEl.textContent = `${hours}h ${minutes}m`;

  // Calcul de la progression depuis la prière précédente
  const prevPrayerDate = getPreviousPrayerTime();
  if (prevPrayerDate) {
    const total = targetDate - prevPrayerDate;
    const elapsed = Date.now() - prevPrayerDate;
    const percent = Math.min(100, (elapsed / total) * 100);
    progressFill.style.width = `${percent}%`;
  }
}

function getPreviousPrayerTime() {
  const prayersOrder = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const now = new Date();
  let prev = null;
  for (const key of prayersOrder) {
    const time = timings[key];
    if (!time) continue;
    const d = parseTime(time);
    if (d <= now) {
      prev = d;
    } else {
      break;
    }
  }
  return prev;
}

function startLiveUpdates() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const now = new Date();
    currentTimeEl.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // Recalculer le prochain affichage seulement si nécessaire (pas trop lourd)
    drawPrayerTimes();
  }, 1000);
}

// ----- 4. Service Worker et Notifications Push -----
async function registerServiceWorker() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      enableBtn.disabled = false;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        notificationSubscription = subscription;
        notifText.textContent = 'Désactiver les notifications';
        statusText.textContent = 'Notifications activées ✅';
        testBtn.style.display = 'block';
      }
    } catch (err) {
      statusText.textContent = 'Service Worker non enregistré';
    }
  } else {
    statusText.textContent = 'Push non supporté';
  }
}

async function toggleNotifications() {
  if (!notificationSubscription) {
    // Activer
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      statusText.textContent = 'Permission refusée';
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
      notificationSubscription = subscription;
      // Sauvegarder sur le serveur
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      notifText.textContent = 'Désactiver les notifications';
      statusText.textContent = 'Notifications activées 🔔';
      testBtn.style.display = 'block';
    } catch (err) {
      statusText.textContent = 'Erreur lors de la souscription';
    }
  } else {
    // Désactiver
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
    }
    notificationSubscription = null;
    notifText.textContent = 'Activer les notifications';
    statusText.textContent = '';
    testBtn.style.display = 'none';
  }
}

// ----- 5. Test de notification push -----
async function testNotification() {
  if (!notificationSubscription) {
    statusText.textContent = 'Pas de souscription active';
    return;
  }
  statusText.textContent = 'Envoi du test...';
  try {
    const res = await fetch('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notificationSubscription)
    });
    if (res.ok) {
      statusText.textContent = 'Test envoyé ! Vérifiez la notification.';
    } else {
      statusText.textContent = 'Échec de l\'envoi du test.';
    }
  } catch {
    statusText.textContent = 'Erreur réseau lors du test.';
  }
}

// Utilitaire
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ----- Écouteurs -----
enableBtn.addEventListener('click', toggleNotifications);
testBtn.addEventListener('click', testNotification);

// ----- Démarrage -----
initGeolocation();
registerServiceWorker();