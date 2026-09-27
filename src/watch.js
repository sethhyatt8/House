import mqtt from 'mqtt';

const BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function watchCodeFromUrl() {
  const raw = new URLSearchParams(location.search).get('watch');
  if (raw == null) return '';
  return raw.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
}

export function hostRoomCode() {
  const saved = sessionStorage.getItem('brick-room-code');
  if (saved && saved.length === 4) return saved;
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  sessionStorage.setItem('brick-room-code', code);
  return code;
}

export function openRoom(code, { role, onSnapshot, onWatchers, onStatus }) {
  const clientId = `brick-${role}-${Math.random().toString(16).slice(2)}`;
  const stateTopic = `sethhyatt8/brick-room/${code}/state`;
  const hereTopic = `sethhyatt8/brick-room/${code}/here`;
  const watchers = new Map();
  let client = null;
  try {
    client = mqtt.connect(BROKER, {
      clientId,
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: 8000,
      protocolVersion: 4,
    });
  } catch {
    onStatus?.('offline');
    return { send() {}, close() {}, watcherCount: () => 0 };
  }

  client.on('connect', () => {
    onStatus?.('connected');
    if (role === 'watch') {
      client.subscribe(stateTopic);
      client.publish(hereTopic, clientId);
    } else client.subscribe(hereTopic);
  });
  client.on('error', () => onStatus?.('offline'));
  client.on('offline', () => onStatus?.('offline'));
  client.on('message', (topic, payload) => {
    const text = payload.toString();
    if (topic === stateTopic && role === 'watch') {
      try {
        onSnapshot?.(JSON.parse(text));
      } catch {
        // Ignore a bad packet and wait for the next one.
      }
      return;
    }
    if (topic === hereTopic && role === 'host') {
      watchers.set(text, Date.now());
      onWatchers?.(liveWatchers());
    }
  });

  function liveWatchers() {
    const now = Date.now();
    for (const [id, seen] of watchers) {
      if (now - seen > 6000) watchers.delete(id);
    }
    return watchers.size;
  }

  return {
    send(data) {
      if (!client?.connected || liveWatchers() < 1) return;
      client.publish(stateTopic, JSON.stringify(data));
    },
    ping() {
      if (role === 'watch' && client?.connected) client.publish(hereTopic, clientId);
    },
    watcherCount: liveWatchers,
    close() {
      client?.end(true);
    },
  };
}
