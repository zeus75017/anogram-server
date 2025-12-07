const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// ==================== CONFIGURATION PRODUCTION ====================
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Gestion des erreurs non capturées pour éviter les crashes
process.on('uncaughtException', (err) => {
  console.error('Erreur non capturée:', err);
  // Ne pas exit, continuer à fonctionner
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesse rejetée non gérée:', reason);
});

console.log(`
========================================
   ANOGRAM SERVER - ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}
========================================
`);

// Configuration de sécurité
const {
  encrypt,
  decrypt,
  sanitizeInput,
  isValidPhone,
  isValidUsername,
  securityConfig,
  JWT_SECRET
} = require('./config/security');

// Initialiser la base de données
const db = require('./database/init');

// S'assurer que Zeus est admin à chaque démarrage
try {
  const result = db.prepare(`UPDATE users SET is_admin = 1 WHERE LOWER(username) = 'zeus'`).run();
  if (result.changes > 0) {
    console.log('Zeus défini comme admin');
  }
} catch (e) {
  console.log('Pas d\'utilisateur Zeus trouvé ou erreur:', e.message);
}

const app = express();

// Trust proxy pour Render.com (nécessaire pour le rate limiting)
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ==================== MIDDLEWARES DE SÉCURITÉ ====================

// Helmet pour les headers de sécurité
app.use(helmet({
  contentSecurityPolicy: false, // Désactivé pour Electron
  crossOriginEmbedderPolicy: false
}));

// Rate limiting global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Trop de requêtes, veuillez réessayer plus tard' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Rate limiting strict pour l'authentification
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives, veuillez réessayer dans 1 heure' },
  standardHeaders: true,
  legacyHeaders: false
});

// CORS sécurisé
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ==================== HEALTH CHECK & STATS ====================
let serverStartTime = Date.now();
let totalConnections = 0;
let activeConnections = 0;

// Route de health check pour Render (garde le serveur éveillé)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    activeConnections,
    totalConnections,
    timestamp: new Date().toISOString()
  });
});

// Route racine
app.get('/', (req, res) => {
  res.json({
    name: 'Anogram Server',
    version: '1.0.0',
    status: 'running',
    uptime: Math.floor((Date.now() - serverStartTime) / 1000) + 's'
  });
});

// Configuration Multer sécurisée pour les avatars
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/avatars');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Nom de fichier sécurisé
    const uniqueName = `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  }
});

// Filtre de fichiers sécurisé
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  }
});

// Middleware d'authentification sécurisé
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requis' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expiré' });
      }
      return res.status(403).json({ error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
};

// Middleware de validation des entrées
const validateInput = (fields) => {
  return (req, res, next) => {
    for (const field of fields) {
      if (req.body[field]) {
        req.body[field] = sanitizeInput(req.body[field]);
      }
    }
    next();
  };
};

// ==================== ROUTES AUTH ====================

// Inscription sécurisée
app.post('/api/auth/register', authLimiter, validateInput(['username', 'displayName', 'phone']), async (req, res) => {
  try {
    const { username, phone, password, displayName } = req.body;

    // Validation
    if (!username || !phone || !password || !displayName) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Nom d\'utilisateur invalide (3-30 caractères alphanumériques)' });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    if (displayName.length < 2 || displayName.length > 50) {
      return res.status(400).json({ error: 'Le nom doit contenir entre 2 et 50 caractères' });
    }

    // Vérifier si l'utilisateur existe
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR phone = ?')
      .get(username.toLowerCase(), phone);

    if (existingUser) {
      return res.status(400).json({ error: 'Nom d\'utilisateur ou téléphone déjà utilisé' });
    }

    // Hash du mot de passe avec bcrypt (coût élevé)
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    // Chiffrer le numéro de téléphone
    const encryptedPhone = encrypt(phone);

    db.prepare(`
      INSERT INTO users (id, username, phone, password, display_name, show_phone, show_last_seen, show_profile_photo)
      VALUES (?, ?, ?, ?, ?, 0, 1, 1)
    `).run(userId, username.toLowerCase(), encryptedPhone, hashedPassword, sanitizeInput(displayName));

    // Token JWT sécurisé
    const token = jwt.sign(
      { userId, username: username.toLowerCase() },
      JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: userId,
        username: username.toLowerCase(),
        phone,
        displayName: sanitizeInput(displayName),
        avatar: '',
        bio: '',
        showPhone: false,
        showLastSeen: true,
        showProfilePhoto: true
      }
    });
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Connexion sécurisée
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Identifiants requis' });
    }

    // Recherche par username ou téléphone chiffré
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get(login.toLowerCase());

    if (!user) {
      // Recherche par téléphone (on doit décrypter)
      const allUsers = db.prepare('SELECT * FROM users').all();
      user = allUsers.find(u => decrypt(u.phone) === login);
    }

    if (!user) {
      // Délai pour prévenir l'énumération d'utilisateurs
      await new Promise(resolve => setTimeout(resolve, 1000));
      return res.status(400).json({ error: 'Identifiants incorrects' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return res.status(400).json({ error: 'Identifiants incorrects' });
    }

    db.prepare('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?')
      .run('online', user.id);

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        phone: decrypt(user.phone),
        displayName: user.display_name,
        avatar: user.avatar,
        bio: user.bio,
        showPhone: !!user.show_phone,
        showLastSeen: !!user.show_last_seen,
        showProfilePhoto: !!user.show_profile_photo
      }
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vérifier le token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      phone: decrypt(user.phone),
      displayName: user.display_name,
      avatar: user.avatar,
      bio: user.bio,
      showPhone: !!user.show_phone,
      showLastSeen: !!user.show_last_seen,
      showProfilePhoto: !!user.show_profile_photo
    }
  });
});

// ==================== ROUTES UTILISATEURS ====================

// Rechercher des utilisateurs
app.get('/api/users/search', authenticateToken, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json({ users: [] });
  }

  const sanitizedQuery = sanitizeInput(q);
  const users = db.prepare(`
    SELECT id, username, display_name, avatar, status, last_seen, show_phone, phone, show_last_seen, show_profile_photo
    FROM users
    WHERE (username LIKE ? OR display_name LIKE ?)
    AND id != ?
    LIMIT 20
  `).all(`%${sanitizedQuery}%`, `%${sanitizedQuery}%`, req.user.userId);

  res.json({
    users: users.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatar: u.show_profile_photo ? u.avatar : '',
      status: u.show_last_seen ? u.status : 'hidden',
      lastSeen: u.show_last_seen ? u.last_seen : null,
      phone: u.show_phone ? decrypt(u.phone) : null
    }))
  });
});

// Mettre à jour le profil
app.put('/api/users/profile', authenticateToken, validateInput(['displayName', 'bio']), (req, res) => {
  const { displayName, bio, showPhone, showLastSeen, showProfilePhoto } = req.body;

  if (displayName && (displayName.length < 2 || displayName.length > 50)) {
    return res.status(400).json({ error: 'Le nom doit contenir entre 2 et 50 caractères' });
  }

  if (bio && bio.length > 200) {
    return res.status(400).json({ error: 'La bio ne peut pas dépasser 200 caractères' });
  }

  db.prepare(`
    UPDATE users SET
      display_name = ?,
      bio = ?,
      show_phone = ?,
      show_last_seen = ?,
      show_profile_photo = ?
    WHERE id = ?
  `).run(
    sanitizeInput(displayName),
    sanitizeInput(bio) || '',
    showPhone ? 1 : 0,
    showLastSeen ? 1 : 0,
    showProfilePhoto ? 1 : 0,
    req.user.userId
  );

  res.json({ success: true });
});

// Upload avatar sécurisé
app.post('/api/users/avatar', authenticateToken, upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier' });
  }

  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.user.userId);

  res.json({ success: true, avatar: avatarUrl });
});

// ==================== ROUTES CONTACTS ====================

app.get('/api/contacts', authenticateToken, (req, res) => {
  const contacts = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.status, u.last_seen, u.phone, u.show_phone, u.show_last_seen, u.show_profile_photo
    FROM contacts c
    INNER JOIN users u ON c.contact_id = u.id
    WHERE c.user_id = ?
    ORDER BY u.display_name
  `).all(req.user.userId);

  res.json({
    contacts: contacts.map(c => ({
      id: c.contact_id,
      username: c.username,
      displayName: c.nickname || c.display_name,
      originalName: c.display_name,
      avatar: c.show_profile_photo ? c.avatar : '',
      status: c.show_last_seen ? c.status : 'hidden',
      lastSeen: c.show_last_seen ? c.last_seen : null,
      phone: c.show_phone ? decrypt(c.phone) : null,
      nickname: c.nickname
    }))
  });
});

app.post('/api/contacts', authenticateToken, (req, res) => {
  const { contactId, nickname } = req.body;

  if (!contactId) {
    return res.status(400).json({ error: 'Contact ID requis' });
  }

  try {
    db.prepare('INSERT INTO contacts (user_id, contact_id, nickname) VALUES (?, ?, ?)')
      .run(req.user.userId, contactId, sanitizeInput(nickname) || null);

    const contact = db.prepare(`
      SELECT u.*, c.nickname FROM users u
      LEFT JOIN contacts c ON c.contact_id = u.id AND c.user_id = ?
      WHERE u.id = ?
    `).get(req.user.userId, contactId);

    res.json({
      success: true,
      contact: {
        id: contact.id,
        username: contact.username,
        displayName: contact.nickname || contact.display_name,
        avatar: contact.avatar,
        status: contact.status,
        phone: contact.show_phone ? decrypt(contact.phone) : null
      }
    });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Contact déjà ajouté' });
    }
    throw error;
  }
});

app.delete('/api/contacts/:contactId', authenticateToken, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?')
    .run(req.user.userId, req.params.contactId);
  res.json({ success: true });
});

// ==================== ROUTES GROUPES ====================

app.post('/api/groups', authenticateToken, upload.single('avatar'), (req, res) => {
  const { name, description, members } = req.body;
  const memberIds = JSON.parse(members || '[]');

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Le nom du groupe est requis (min 2 caractères)' });
  }

  const groupId = uuidv4();
  const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : '';

  db.prepare(`
    INSERT INTO conversations (id, type, name, avatar, description, created_by)
    VALUES (?, 'group', ?, ?, ?, ?)
  `).run(groupId, sanitizeInput(name), avatarUrl, sanitizeInput(description) || '', req.user.userId);

  db.prepare('INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)')
    .run(groupId, req.user.userId, 'admin');

  memberIds.forEach(memberId => {
    if (memberId !== req.user.userId) {
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)')
        .run(groupId, memberId, 'member');
    }
  });

  res.json({
    success: true,
    group: {
      id: groupId,
      name: sanitizeInput(name),
      avatar: avatarUrl,
      description: sanitizeInput(description) || '',
      type: 'group'
    }
  });
});

app.get('/api/groups/:groupId', authenticateToken, (req, res) => {
  const group = db.prepare('SELECT * FROM conversations WHERE id = ? AND (type = ? OR type = ?)')
    .get(req.params.groupId, 'group', 'channel');

  if (!group) {
    return res.status(404).json({ error: 'Groupe non trouvé' });
  }

  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.status, cp.role
    FROM conversation_participants cp
    INNER JOIN users u ON cp.user_id = u.id
    WHERE cp.conversation_id = ?
  `).all(req.params.groupId);

  res.json({
    group: {
      id: group.id,
      name: group.name,
      avatar: group.avatar,
      description: group.description,
      createdBy: group.created_by,
      createdAt: group.created_at,
      type: group.type,
      members: members.map(m => ({
        id: m.id,
        username: m.username,
        displayName: m.display_name,
        avatar: m.avatar,
        status: m.status,
        role: m.role
      }))
    }
  });
});

app.post('/api/groups/:groupId/members', authenticateToken, (req, res) => {
  const { memberIds } = req.body;

  const participant = db.prepare(`
    SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(req.params.groupId, req.user.userId);

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Seuls les admins peuvent ajouter des membres' });
  }

  memberIds.forEach(memberId => {
    try {
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)')
        .run(req.params.groupId, memberId, 'member');
    } catch (e) {}
  });

  res.json({ success: true });
});

app.delete('/api/groups/:groupId/leave', authenticateToken, (req, res) => {
  db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
    .run(req.params.groupId, req.user.userId);
  res.json({ success: true });
});

app.put('/api/groups/:groupId', authenticateToken, upload.single('avatar'), (req, res) => {
  const { name, description } = req.body;

  const participant = db.prepare(`
    SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(req.params.groupId, req.user.userId);

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Seuls les admins peuvent modifier le groupe' });
  }

  if (req.file) {
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    db.prepare('UPDATE conversations SET name = ?, description = ?, avatar = ? WHERE id = ?')
      .run(sanitizeInput(name), sanitizeInput(description) || '', avatarUrl, req.params.groupId);
  } else {
    db.prepare('UPDATE conversations SET name = ?, description = ? WHERE id = ?')
      .run(sanitizeInput(name), sanitizeInput(description) || '', req.params.groupId);
  }

  res.json({ success: true });
});

app.delete('/api/groups/:groupId/members/:memberId', authenticateToken, (req, res) => {
  const participant = db.prepare(`
    SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(req.params.groupId, req.user.userId);

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Seuls les admins peuvent supprimer des membres' });
  }

  const memberToRemove = db.prepare(`
    SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(req.params.groupId, req.params.memberId);

  if (memberToRemove && memberToRemove.role === 'admin') {
    return res.status(403).json({ error: 'Impossible de supprimer l\'admin' });
  }

  db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
    .run(req.params.groupId, req.params.memberId);

  res.json({ success: true });
});

// ==================== ROUTES CANAUX ====================

app.post('/api/channels', authenticateToken, upload.single('avatar'), (req, res) => {
  const { name, description } = req.body;

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Le nom du canal est requis' });
  }

  const channelId = uuidv4();
  const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : '';

  db.prepare(`
    INSERT INTO conversations (id, type, name, avatar, description, created_by)
    VALUES (?, 'channel', ?, ?, ?, ?)
  `).run(channelId, sanitizeInput(name), avatarUrl, sanitizeInput(description) || '', req.user.userId);

  db.prepare('INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)')
    .run(channelId, req.user.userId, 'admin');

  res.json({
    success: true,
    channel: {
      id: channelId,
      name: sanitizeInput(name),
      avatar: avatarUrl,
      description: sanitizeInput(description) || '',
      type: 'channel'
    }
  });
});

app.get('/api/channels/:channelId', authenticateToken, (req, res) => {
  const channel = db.prepare('SELECT * FROM conversations WHERE id = ? AND type = ?')
    .get(req.params.channelId, 'channel');

  if (!channel) {
    return res.status(404).json({ error: 'Canal non trouvé' });
  }

  const subscribers = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.status, cp.role
    FROM conversation_participants cp
    INNER JOIN users u ON cp.user_id = u.id
    WHERE cp.conversation_id = ?
  `).all(req.params.channelId);

  res.json({
    channel: {
      id: channel.id,
      name: channel.name,
      avatar: channel.avatar,
      description: channel.description,
      createdBy: channel.created_by,
      createdAt: channel.created_at,
      subscriberCount: subscribers.length,
      subscribers: subscribers.map(s => ({
        id: s.id,
        username: s.username,
        displayName: s.display_name,
        avatar: s.avatar,
        status: s.status,
        role: s.role
      }))
    }
  });
});

app.put('/api/channels/:channelId', authenticateToken, upload.single('avatar'), (req, res) => {
  const { name, description } = req.body;

  const participant = db.prepare(`
    SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(req.params.channelId, req.user.userId);

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Seuls les admins peuvent modifier le canal' });
  }

  if (req.file) {
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    db.prepare('UPDATE conversations SET name = ?, description = ?, avatar = ? WHERE id = ?')
      .run(sanitizeInput(name), sanitizeInput(description) || '', avatarUrl, req.params.channelId);
  } else {
    db.prepare('UPDATE conversations SET name = ?, description = ? WHERE id = ?')
      .run(sanitizeInput(name), sanitizeInput(description) || '', req.params.channelId);
  }

  res.json({ success: true });
});

// ==================== ROUTES MESSAGES ENREGISTRÉS ====================

app.get('/api/saved-messages', authenticateToken, (req, res) => {
  const savedMessages = db.prepare(`
    SELECT sm.*, m.content, m.type, m.created_at, m.sender_id,
           u.display_name as sender_name, u.avatar as sender_avatar,
           c.name as conversation_name, c.type as conversation_type
    FROM saved_messages sm
    INNER JOIN messages m ON sm.message_id = m.id
    INNER JOIN users u ON m.sender_id = u.id
    INNER JOIN conversations c ON sm.conversation_id = c.id
    WHERE sm.user_id = ?
    ORDER BY sm.saved_at DESC
  `).all(req.user.userId);

  res.json({
    savedMessages: savedMessages.map(sm => ({
      id: sm.id,
      messageId: sm.message_id,
      conversationId: sm.conversation_id,
      content: decrypt(sm.content),
      type: sm.type,
      createdAt: sm.created_at,
      savedAt: sm.saved_at,
      senderId: sm.sender_id,
      senderName: sm.sender_name,
      senderAvatar: sm.sender_avatar,
      conversationName: sm.conversation_name,
      conversationType: sm.conversation_type
    }))
  });
});

app.post('/api/saved-messages', authenticateToken, (req, res) => {
  const { messageId, conversationId } = req.body;

  try {
    db.prepare('INSERT INTO saved_messages (user_id, message_id, conversation_id) VALUES (?, ?, ?)')
      .run(req.user.userId, messageId, conversationId);
    res.json({ success: true });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Message déjà enregistré' });
    }
    throw error;
  }
});

app.delete('/api/saved-messages/:messageId', authenticateToken, (req, res) => {
  db.prepare('DELETE FROM saved_messages WHERE user_id = ? AND message_id = ?')
    .run(req.user.userId, req.params.messageId);
  res.json({ success: true });
});

// ==================== ROUTES APPELS ====================

app.get('/api/calls', authenticateToken, (req, res) => {
  const calls = db.prepare(`
    SELECT c.*,
           caller.display_name as caller_name, caller.avatar as caller_avatar,
           receiver.display_name as receiver_name, receiver.avatar as receiver_avatar
    FROM calls c
    INNER JOIN users caller ON c.caller_id = caller.id
    INNER JOIN users receiver ON c.receiver_id = receiver.id
    WHERE c.caller_id = ? OR c.receiver_id = ?
    ORDER BY c.started_at DESC
    LIMIT 50
  `).all(req.user.userId, req.user.userId);

  res.json({
    calls: calls.map(c => ({
      id: c.id,
      callerId: c.caller_id,
      callerName: c.caller_name,
      callerAvatar: c.caller_avatar,
      receiverId: c.receiver_id,
      receiverName: c.receiver_name,
      receiverAvatar: c.receiver_avatar,
      type: c.type,
      status: c.status,
      startedAt: c.started_at,
      endedAt: c.ended_at,
      duration: c.duration,
      isOutgoing: c.caller_id === req.user.userId
    }))
  });
});

app.post('/api/calls', authenticateToken, (req, res) => {
  const { receiverId, type } = req.body;
  const callId = uuidv4();

  db.prepare(`
    INSERT INTO calls (id, caller_id, receiver_id, type, status)
    VALUES (?, ?, ?, ?, 'calling')
  `).run(callId, req.user.userId, receiverId, type || 'audio');

  res.json({
    success: true,
    call: {
      id: callId,
      callerId: req.user.userId,
      receiverId,
      type: type || 'audio',
      status: 'calling'
    }
  });
});

app.put('/api/calls/:callId', authenticateToken, (req, res) => {
  const { status, duration } = req.body;

  if (status === 'ended') {
    db.prepare(`
      UPDATE calls SET status = ?, duration = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, duration || 0, req.params.callId);
  } else {
    db.prepare('UPDATE calls SET status = ? WHERE id = ?').run(status, req.params.callId);
  }

  res.json({ success: true });
});

// ==================== ROUTES CONVERSATIONS ====================

app.get('/api/conversations', authenticateToken, (req, res) => {
  const conversations = db.prepare(`
    SELECT
      c.*,
      (
        SELECT json_object(
          'id', m.id,
          'content', m.content,
          'senderId', m.sender_id,
          'createdAt', m.created_at
        )
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) as last_message,
      (
        SELECT COUNT(*)
        FROM messages m
        WHERE m.conversation_id = c.id
        AND m.sender_id != ?
        AND NOT EXISTS (
          SELECT 1 FROM json_each(m.read_by)
          WHERE json_each.value = ?
        )
      ) as unread_count
    FROM conversations c
    INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
    WHERE cp.user_id = ?
    ORDER BY c.updated_at DESC
  `).all(req.user.userId, req.user.userId, req.user.userId);

  const enrichedConversations = conversations.map(conv => {
    const participants = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, u.status, u.last_seen, u.show_last_seen, u.show_profile_photo, cp.role
      FROM users u
      INNER JOIN conversation_participants cp ON u.id = cp.user_id
      WHERE cp.conversation_id = ?
    `).all(conv.id);

    let otherUser = null;
    if (conv.type === 'private') {
      otherUser = participants.find(p => p.id !== req.user.userId);
    }

    let lastMessage = null;
    if (conv.last_message) {
      const parsed = JSON.parse(conv.last_message);
      lastMessage = {
        ...parsed,
        content: decrypt(parsed.content)
      };
    }

    return {
      id: conv.id,
      type: conv.type,
      name: conv.type === 'private' ? otherUser?.display_name : conv.name,
      avatar: conv.type === 'private'
        ? (otherUser?.show_profile_photo ? otherUser?.avatar : '')
        : conv.avatar,
      description: conv.description,
      status: conv.type === 'private'
        ? (otherUser?.show_last_seen ? otherUser?.status : 'hidden')
        : null,
      lastSeen: conv.type === 'private'
        ? (otherUser?.show_last_seen ? otherUser?.last_seen : null)
        : null,
      lastMessage,
      unreadCount: conv.unread_count,
      participants: participants.map(p => ({
        id: p.id,
        username: p.username,
        displayName: p.display_name,
        avatar: p.show_profile_photo ? p.avatar : '',
        status: p.show_last_seen ? p.status : 'hidden',
        role: p.role
      })),
      updatedAt: conv.updated_at
    };
  });

  res.json({ conversations: enrichedConversations });
});

app.post('/api/conversations/private', authenticateToken, (req, res) => {
  const { userId } = req.body;

  const existingConv = db.prepare(`
    SELECT c.id
    FROM conversations c
    INNER JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
    INNER JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
    WHERE c.type = 'private'
    AND cp1.user_id = ?
    AND cp2.user_id = ?
  `).get(req.user.userId, userId);

  if (existingConv) {
    return res.json({ conversationId: existingConv.id, existing: true });
  }

  const convId = uuidv4();
  db.prepare('INSERT INTO conversations (id, type) VALUES (?, ?)').run(convId, 'private');
  db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, req.user.userId);
  db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, userId);

  res.json({ conversationId: convId, existing: false });
});

app.get('/api/conversations/:id/messages', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { limit = 50, before } = req.query;

  // Vérifier que l'utilisateur est dans la conversation
  const participant = db.prepare(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(id, req.user.userId);

  if (!participant) {
    return res.status(403).json({ error: 'Accès non autorisé' });
  }

  let query = `
    SELECT m.*, u.username, u.display_name, u.avatar
    FROM messages m
    INNER JOIN users u ON m.sender_id = u.id
    WHERE m.conversation_id = ?
  `;

  const params = [id];

  if (before) {
    query += ' AND m.created_at < ?';
    params.push(before);
  }

  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const messages = db.prepare(query).all(...params);

  const savedMessageIds = db.prepare(`
    SELECT message_id FROM saved_messages WHERE user_id = ?
  `).all(req.user.userId).map(sm => sm.message_id);

  res.json({
    messages: messages.reverse().map(m => ({
      id: m.id,
      content: decrypt(m.content),
      type: m.type,
      senderId: m.sender_id,
      senderName: m.display_name,
      senderAvatar: m.avatar,
      readBy: JSON.parse(m.read_by),
      createdAt: m.created_at,
      isSaved: savedMessageIds.includes(m.id)
    }))
  });
});

// Supprimer un message
app.delete('/api/messages/:messageId', authenticateToken, (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);

  if (!message) {
    return res.status(404).json({ error: 'Message non trouvé' });
  }

  if (message.sender_id !== req.user.userId) {
    return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres messages' });
  }

  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.messageId);
  db.prepare('DELETE FROM saved_messages WHERE message_id = ?').run(req.params.messageId);

  res.json({ success: true });
});

// ==================== UPLOAD DE FICHIERS ====================

// Configuration Multer pour les fichiers de messages
const messageFileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/files');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  }
});

const messageFileFilter = (req, file, cb) => {
  // Types de fichiers autorisés
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'application/zip', 'application/x-rar-compressed'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé'), false);
  }
};

const uploadMessageFile = multer({
  storage: messageFileStorage,
  fileFilter: messageFileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB max
  }
});

// Route pour uploader un fichier
app.post('/api/upload/file', authenticateToken, uploadMessageFile.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier' });
  }

  const fileUrl = `/uploads/files/${req.file.filename}`;
  const fileType = req.file.mimetype.startsWith('image/') ? 'image' :
                   req.file.mimetype.startsWith('video/') ? 'video' :
                   req.file.mimetype.startsWith('audio/') ? 'audio' : 'file';

  res.json({
    success: true,
    file: {
      url: fileUrl,
      name: req.file.originalname,
      size: req.file.size,
      type: fileType,
      mimetype: req.file.mimetype
    }
  });
});

// Rechercher dans les messages d'une conversation
app.get('/api/conversations/:id/search', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { q } = req.query;

  if (!q || q.length < 2) {
    return res.json({ messages: [] });
  }

  // Vérifier que l'utilisateur est dans la conversation
  const participant = db.prepare(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
  `).get(id, req.user.userId);

  if (!participant) {
    return res.status(403).json({ error: 'Accès non autorisé' });
  }

  // Récupérer tous les messages de la conversation pour la recherche
  const allMessages = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar
    FROM messages m
    INNER JOIN users u ON m.sender_id = u.id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC
    LIMIT 500
  `).all(id);

  // Rechercher dans le contenu décrypté
  const query = q.toLowerCase();
  const matchingMessages = allMessages.filter(m => {
    const content = decrypt(m.content).toLowerCase();
    return content.includes(query);
  }).slice(0, 50);

  res.json({
    messages: matchingMessages.map(m => ({
      id: m.id,
      content: decrypt(m.content),
      senderId: m.sender_id,
      senderName: m.display_name,
      createdAt: m.created_at
    }))
  });
});

// ==================== SOCKET.IO SÉCURISÉ ====================

const connectedUsers = new Map();
const socketRateLimits = new Map();

// Rate limiting pour les sockets
function checkSocketRateLimit(socketId, action) {
  const key = `${socketId}:${action}`;
  const now = Date.now();
  const limit = socketRateLimits.get(key) || { count: 0, resetTime: now + 60000 };

  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = now + 60000;
  }

  limit.count++;
  socketRateLimits.set(key, limit);

  return limit.count <= 60; // 60 actions par minute max
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Token requis'));
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) return next(new Error('Token invalide'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = socket.user.userId;

  // Stats de connexion
  totalConnections++;
  activeConnections++;
  console.log(`[+] Utilisateur connecté: ${userId} (actifs: ${activeConnections}, total: ${totalConnections})`);

  connectedUsers.set(userId, socket.id);

  db.prepare('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?')
    .run('online', userId);

  const conversations = db.prepare(`
    SELECT conversation_id FROM conversation_participants WHERE user_id = ?
  `).all(userId);

  conversations.forEach(conv => {
    socket.join(conv.conversation_id);
  });

  socket.broadcast.emit('user_status', { userId, status: 'online' });

  // Envoyer un message (chiffré)
  socket.on('send_message', (data) => {
    if (!checkSocketRateLimit(socket.id, 'send_message')) {
      socket.emit('error', { message: 'Trop de messages, ralentissez' });
      return;
    }

    const { conversationId, content, type = 'text' } = data;

    if (!content || content.trim().length === 0) return;
    if (content.length > 10000) {
      socket.emit('error', { message: 'Message trop long (max 10000 caractères)' });
      return;
    }

    // Vérifier que l'utilisateur est dans la conversation
    const participant = db.prepare(`
      SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
    `).get(conversationId, userId);

    if (!participant) return;

    // Pour les canaux, seul l'admin peut envoyer
    const conv = db.prepare('SELECT type FROM conversations WHERE id = ?').get(conversationId);
    if (conv && conv.type === 'channel' && participant.role !== 'admin') {
      socket.emit('error', { message: 'Seul l\'admin peut publier dans ce canal' });
      return;
    }

    const messageId = uuidv4();
    const now = new Date().toISOString();
    const encryptedContent = encrypt(sanitizeInput(content.trim()));

    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(messageId, conversationId, userId, encryptedContent, type, now);

    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);

    const sender = db.prepare('SELECT username, display_name, avatar FROM users WHERE id = ?').get(userId);

    const message = {
      id: messageId,
      conversationId,
      content: sanitizeInput(content.trim()),
      type,
      senderId: userId,
      senderName: sender.display_name,
      senderAvatar: sender.avatar,
      readBy: [],
      createdAt: now,
      isSaved: false
    };

    io.to(conversationId).emit('new_message', message);
  });

  // Marquer les messages comme lus
  socket.on('mark_read', (data) => {
    if (!checkSocketRateLimit(socket.id, 'mark_read')) return;

    const { conversationId } = data;

    const messages = db.prepare(`
      SELECT id, read_by FROM messages
      WHERE conversation_id = ? AND sender_id != ?
    `).all(conversationId, userId);

    messages.forEach(msg => {
      const readBy = JSON.parse(msg.read_by);
      if (!readBy.includes(userId)) {
        readBy.push(userId);
        db.prepare('UPDATE messages SET read_by = ? WHERE id = ?')
          .run(JSON.stringify(readBy), msg.id);
      }
    });

    io.to(conversationId).emit('messages_read', { conversationId, userId });
  });

  // Indicateur de frappe
  socket.on('typing', (data) => {
    if (!checkSocketRateLimit(socket.id, 'typing')) return;
    const { conversationId } = data;
    socket.to(conversationId).emit('user_typing', { conversationId, userId });
  });

  socket.on('stop_typing', (data) => {
    const { conversationId } = data;
    socket.to(conversationId).emit('user_stop_typing', { conversationId, userId });
  });

  socket.on('join_conversation', (conversationId) => {
    // Vérifier que l'utilisateur est dans la conversation
    const participant = db.prepare(`
      SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?
    `).get(conversationId, userId);

    if (participant) {
      socket.join(conversationId);
    }
  });

  // Appels
  socket.on('call_user', (data) => {
    if (!checkSocketRateLimit(socket.id, 'call')) return;

    const { receiverId, callId, type } = data;
    const receiverSocketId = connectedUsers.get(receiverId);

    if (receiverSocketId) {
      const caller = db.prepare('SELECT display_name, avatar FROM users WHERE id = ?').get(userId);
      io.to(receiverSocketId).emit('incoming_call', {
        callId,
        callerId: userId,
        callerName: caller.display_name,
        callerAvatar: caller.avatar,
        type
      });
    }
  });

  socket.on('answer_call', (data) => {
    const { callId, callerId, accepted } = data;
    const callerSocketId = connectedUsers.get(callerId);

    if (callerSocketId) {
      io.to(callerSocketId).emit('call_answered', { callId, accepted });
    }

    if (accepted) {
      db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('active', callId);
    } else {
      db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('declined', callId);
    }
  });

  socket.on('end_call', (data) => {
    const { callId, otherUserId, duration } = data;
    const otherSocketId = connectedUsers.get(otherUserId);

    if (otherSocketId) {
      io.to(otherSocketId).emit('call_ended', { callId });
    }

    db.prepare(`
      UPDATE calls SET status = 'ended', duration = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(duration || 0, callId);
  });

  // Déconnexion
  socket.on('disconnect', () => {
    activeConnections--;
    console.log(`[-] Utilisateur déconnecté: ${userId} (actifs: ${activeConnections})`);
    connectedUsers.delete(userId);

    db.prepare('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?')
      .run('offline', userId);

    socket.broadcast.emit('user_status', { userId, status: 'offline', lastSeen: new Date().toISOString() });
  });
});

// Nettoyage périodique des rate limits
setInterval(() => {
  const now = Date.now();
  for (const [key, limit] of socketRateLimits.entries()) {
    if (now > limit.resetTime) {
      socketRateLimits.delete(key);
    }
  }
}, 60000);

// ==================== ROUTES ADMIN ====================

// Middleware de vérification admin
const requireAdmin = (req, res, next) => {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
};

// Log une action admin
function logAdminAction(action, targetType, targetId, adminId, details = null) {
  db.prepare(`
    INSERT INTO admin_logs (action, target_type, target_id, admin_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(action, targetType, targetId, adminId, details ? JSON.stringify(details) : null);
}

// Vérifier si l'utilisateur est admin
app.get('/api/admin/check', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.userId);
  res.json({ isAdmin: !!(user && user.is_admin) });
});

// Statistiques du dashboard admin
app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const onlineUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE status = ?').get('online').count;
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const totalConversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
  const totalGroups = db.prepare('SELECT COUNT(*) as count FROM conversations WHERE type = ?').get('group').count;
  const totalChannels = db.prepare('SELECT COUNT(*) as count FROM conversations WHERE type = ?').get('channel').count;
  const totalCalls = db.prepare('SELECT COUNT(*) as count FROM calls').get().count;

  // Messages aujourd'hui
  const today = new Date().toISOString().split('T')[0];
  const messagesToday = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE date(created_at) = ?`).get(today).count;

  // Nouveaux utilisateurs aujourd'hui
  const newUsersToday = db.prepare(`SELECT COUNT(*) as count FROM users WHERE date(created_at) = ?`).get(today).count;

  // Utilisateurs actifs (ont envoyé un message dans les dernières 24h)
  const activeUsers = db.prepare(`
    SELECT COUNT(DISTINCT sender_id) as count FROM messages
    WHERE created_at > datetime('now', '-24 hours')
  `).get().count;

  res.json({
    totalUsers,
    onlineUsers,
    totalMessages,
    totalConversations,
    totalGroups,
    totalChannels,
    totalCalls,
    messagesToday,
    newUsersToday,
    activeUsers
  });
});

// Liste des utilisateurs
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, display_name, avatar, status, last_seen, created_at, is_admin,
           (SELECT COUNT(*) FROM messages WHERE sender_id = users.id) as message_count
    FROM users
    ORDER BY created_at DESC
  `).all();

  res.json({
    users: users.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatar: u.avatar,
      status: u.status,
      lastSeen: u.last_seen,
      createdAt: u.created_at,
      isAdmin: !!u.is_admin,
      messageCount: u.message_count
    }))
  });
});

// Détails d'un utilisateur
app.get('/api/admin/users/:userId', authenticateToken, requireAdmin, (req, res) => {
  const user = db.prepare(`
    SELECT id, username, display_name, bio, avatar, status, last_seen, created_at, is_admin, phone
    FROM users WHERE id = ?
  `).get(req.params.userId);

  if (!user) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE sender_id = ?').get(req.params.userId).count;
  const conversationCount = db.prepare('SELECT COUNT(*) as count FROM conversation_participants WHERE user_id = ?').get(req.params.userId).count;

  const recentMessages = db.prepare(`
    SELECT m.*, c.name as conversation_name, c.type as conversation_type
    FROM messages m
    LEFT JOIN conversations c ON m.conversation_id = c.id
    WHERE m.sender_id = ?
    ORDER BY m.created_at DESC
    LIMIT 20
  `).all(req.params.userId);

  res.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      bio: user.bio,
      avatar: user.avatar,
      phone: decrypt(user.phone),
      status: user.status,
      lastSeen: user.last_seen,
      createdAt: user.created_at,
      isAdmin: !!user.is_admin,
      messageCount,
      conversationCount,
      recentMessages: recentMessages.map(m => ({
        id: m.id,
        content: decrypt(m.content),
        type: m.type,
        conversationName: m.conversation_name,
        conversationType: m.conversation_type,
        createdAt: m.created_at
      }))
    }
  });
});

// Supprimer un utilisateur
app.delete('/api/admin/users/:userId', authenticateToken, requireAdmin, (req, res) => {
  const userToDelete = db.prepare('SELECT username, is_admin FROM users WHERE id = ?').get(req.params.userId);

  if (!userToDelete) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  if (userToDelete.is_admin) {
    return res.status(403).json({ error: 'Impossible de supprimer un administrateur' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.userId);
  logAdminAction('delete_user', 'user', req.params.userId, req.user.userId, { username: userToDelete.username });

  res.json({ success: true });
});

// Toggle admin status
app.patch('/api/admin/users/:userId/admin', authenticateToken, requireAdmin, (req, res) => {
  const { isAdmin } = req.body;
  const targetUser = db.prepare('SELECT username, is_admin FROM users WHERE id = ?').get(req.params.userId);

  if (!targetUser) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  // Ne pas permettre de retirer son propre statut admin
  if (req.params.userId === req.user.userId && !isAdmin) {
    return res.status(403).json({ error: 'Vous ne pouvez pas retirer votre propre statut administrateur' });
  }

  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, req.params.userId);
  logAdminAction(isAdmin ? 'promote_admin' : 'demote_admin', 'user', req.params.userId, req.user.userId, { username: targetUser.username });

  res.json({ success: true, isAdmin: isAdmin });
});

// Liste des groupes/canaux
app.get('/api/admin/conversations', authenticateToken, requireAdmin, (req, res) => {
  const conversations = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) as member_count,
           (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
           u.display_name as creator_name
    FROM conversations c
    LEFT JOIN users u ON c.created_by = u.id
    ORDER BY c.created_at DESC
  `).all();

  res.json({
    conversations: conversations.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      avatar: c.avatar,
      description: c.description,
      createdBy: c.created_by,
      creatorName: c.creator_name,
      createdAt: c.created_at,
      memberCount: c.member_count,
      messageCount: c.message_count
    }))
  });
});

// Supprimer une conversation
app.delete('/api/admin/conversations/:conversationId', authenticateToken, requireAdmin, (req, res) => {
  const conv = db.prepare('SELECT name, type FROM conversations WHERE id = ?').get(req.params.conversationId);

  if (!conv) {
    return res.status(404).json({ error: 'Conversation non trouvée' });
  }

  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.conversationId);
  logAdminAction('delete_conversation', 'conversation', req.params.conversationId, req.user.userId, { name: conv.name, type: conv.type });

  res.json({ success: true });
});

// Supprimer un message (admin)
app.delete('/api/admin/messages/:messageId', authenticateToken, requireAdmin, (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);

  if (!message) {
    return res.status(404).json({ error: 'Message non trouvé' });
  }

  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.messageId);
  db.prepare('DELETE FROM saved_messages WHERE message_id = ?').run(req.params.messageId);
  logAdminAction('delete_message', 'message', req.params.messageId, req.user.userId, { content: decrypt(message.content).substring(0, 100) });

  res.json({ success: true });
});

// Logs d'activité admin
app.get('/api/admin/logs', authenticateToken, requireAdmin, (req, res) => {
  const logs = db.prepare(`
    SELECT al.*, u.display_name as admin_name
    FROM admin_logs al
    LEFT JOIN users u ON al.admin_id = u.id
    ORDER BY al.created_at DESC
    LIMIT 100
  `).all();

  res.json({
    logs: logs.map(l => ({
      id: l.id,
      action: l.action,
      targetType: l.target_type,
      targetId: l.target_id,
      adminId: l.admin_id,
      adminName: l.admin_name,
      details: l.details ? JSON.parse(l.details) : null,
      createdAt: l.created_at
    }))
  });
});

// Messages récents globaux
app.get('/api/admin/messages/recent', authenticateToken, requireAdmin, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, u.display_name as sender_name, u.avatar as sender_avatar,
           c.name as conversation_name, c.type as conversation_type
    FROM messages m
    INNER JOIN users u ON m.sender_id = u.id
    LEFT JOIN conversations c ON m.conversation_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 50
  `).all();

  res.json({
    messages: messages.map(m => ({
      id: m.id,
      content: decrypt(m.content),
      type: m.type,
      senderId: m.sender_id,
      senderName: m.sender_name,
      senderAvatar: m.sender_avatar,
      conversationId: m.conversation_id,
      conversationName: m.conversation_name,
      conversationType: m.conversation_type,
      createdAt: m.created_at
    }))
  });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('Erreur:', err);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// Démarrer le serveur
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur Anogram démarré sur le port ${PORT}`);
});

module.exports = { app, server, io };
