const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Chemin du fichier de clés (stocké de manière sécurisée)
const KEYS_FILE = path.join(__dirname, '.keys.json');

// Charger ou générer les clés de production
function loadOrGenerateKeys() {
  if (fs.existsSync(KEYS_FILE)) {
    try {
      const data = fs.readFileSync(KEYS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error('Erreur lecture des clés, génération de nouvelles clés...');
    }
  }

  // Générer de nouvelles clés sécurisées
  const keys = {
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    JWT_SECRET: crypto.randomBytes(64).toString('hex'),
    CREATED_AT: new Date().toISOString()
  };

  // Sauvegarder les clés
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  console.log('Nouvelles clés de production générées et sauvegardées.');

  return keys;
}

const KEYS = loadOrGenerateKeys();

module.exports = {
  ENCRYPTION_KEY: Buffer.from(KEYS.ENCRYPTION_KEY, 'hex'),
  JWT_SECRET: KEYS.JWT_SECRET,

  // Configuration de production
  config: {
    // Serveur
    PORT: process.env.PORT || 3000,
    HOST: process.env.HOST || 'localhost',

    // Base de données
    DB_PATH: path.join(__dirname, '../database/anogram.db'),

    // JWT
    JWT_EXPIRES_IN: '7d',
    JWT_ALGORITHM: 'HS512',

    // Rate limiting
    RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
    RATE_LIMIT_MAX: 100,
    AUTH_RATE_LIMIT_WINDOW: 60 * 60 * 1000, // 1 heure
    AUTH_RATE_LIMIT_MAX: 5,

    // Fichiers
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],

    // Sécurité
    BCRYPT_ROUNDS: 12,
    PASSWORD_MIN_LENGTH: 6,
    USERNAME_MIN_LENGTH: 3,
    USERNAME_MAX_LENGTH: 30,
    DISPLAY_NAME_MIN_LENGTH: 2,
    DISPLAY_NAME_MAX_LENGTH: 50,
    BIO_MAX_LENGTH: 200,
    MESSAGE_MAX_LENGTH: 10000,

    // Socket.io
    SOCKET_RATE_LIMIT: 60, // Actions par minute
    SOCKET_PING_TIMEOUT: 60000,
    SOCKET_PING_INTERVAL: 25000
  }
};
