const crypto = require('crypto');
const { ENCRYPTION_KEY, JWT_SECRET, config } = require('./production');

const IV_LENGTH = 16;

// Chiffrer un texte avec AES-256-CBC
function encrypt(text) {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    console.error('Erreur chiffrement:', e);
    return text;
  }
}

// Déchiffrer un texte
function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  try {
    const parts = text.split(':');
    if (parts.length !== 2) return text;
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    // Si le déchiffrement échoue, retourner le texte original (pour les anciennes données non chiffrées)
    return text;
  }
}

// Générer un hash SHA-256
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Générer un token sécurisé
function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

// Nettoyer les entrées HTML pour prévenir XSS
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/\\/g, '&#x5C;')
    .replace(/`/g, '&#x60;');
}

// Désanitiser pour affichage
function unsanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x5C;/g, '\\')
    .replace(/&#x60;/g, '`');
}

// Valider un numéro de téléphone
function isValidPhone(phone) {
  const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/;
  return phoneRegex.test(phone);
}

// Valider un nom d'utilisateur
function isValidUsername(username) {
  const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
  return usernameRegex.test(username);
}

// Valider la force du mot de passe
function isStrongPassword(password) {
  return password && password.length >= config.PASSWORD_MIN_LENGTH;
}

// Valider le nom d'affichage
function isValidDisplayName(displayName) {
  return displayName &&
    displayName.length >= config.DISPLAY_NAME_MIN_LENGTH &&
    displayName.length <= config.DISPLAY_NAME_MAX_LENGTH;
}

// Valider la bio
function isValidBio(bio) {
  return !bio || bio.length <= config.BIO_MAX_LENGTH;
}

// Vérifier le type de fichier
function isAllowedFileType(mimetype) {
  return config.ALLOWED_FILE_TYPES.includes(mimetype);
}

// Générer un nom de fichier sécurisé
function generateSecureFilename(originalname) {
  const ext = originalname.split('.').pop().toLowerCase();
  const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  if (!allowedExtensions.includes(ext)) {
    throw new Error('Extension de fichier non autorisée');
  }
  return `${crypto.randomBytes(16).toString('hex')}.${ext}`;
}

// Configuration de sécurité exportée
const securityConfig = {
  rateLimit: {
    windowMs: config.RATE_LIMIT_WINDOW,
    max: config.RATE_LIMIT_MAX,
    message: { error: 'Trop de requêtes, veuillez réessayer plus tard' }
  },
  authRateLimit: {
    windowMs: config.AUTH_RATE_LIMIT_WINDOW,
    max: config.AUTH_RATE_LIMIT_MAX,
    message: { error: 'Trop de tentatives de connexion, veuillez réessayer plus tard' }
  },
  jwt: {
    expiresIn: config.JWT_EXPIRES_IN,
    algorithm: config.JWT_ALGORITHM
  }
};

module.exports = {
  encrypt,
  decrypt,
  sha256,
  generateSecureToken,
  sanitizeInput,
  unsanitizeInput,
  isValidPhone,
  isValidUsername,
  isStrongPassword,
  isValidDisplayName,
  isValidBio,
  isAllowedFileType,
  generateSecureFilename,
  securityConfig,
  JWT_SECRET,
  config
};
