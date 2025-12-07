const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Utiliser le dossier actuel pour la base de données
const dbPath = path.join(__dirname, 'anogram.db');
console.log('Base de données:', dbPath);

const db = new Database(dbPath);

// Activer les clés étrangères
db.pragma('foreign_keys = ON');

// Créer les tables
db.exec(`
  -- Table des utilisateurs
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    status TEXT DEFAULT 'offline',
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Paramètres de confidentialité
    show_phone INTEGER DEFAULT 0,
    show_last_seen INTEGER DEFAULT 1,
    show_profile_photo INTEGER DEFAULT 1
  );

  -- Table des conversations
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT DEFAULT 'private',
    name TEXT,
    avatar TEXT,
    description TEXT DEFAULT '',
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  -- Table des participants aux conversations
  CREATE TABLE IF NOT EXISTS conversation_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(conversation_id, user_id)
  );

  -- Table des messages
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    read_by TEXT DEFAULT '[]',
    reply_to TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Table des contacts
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    nickname TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, contact_id)
  );

  -- Table des messages enregistrés (favoris)
  CREATE TABLE IF NOT EXISTS saved_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    UNIQUE(user_id, message_id)
  );

  -- Table des appels
  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    conversation_id TEXT,
    type TEXT DEFAULT 'audio',
    status TEXT DEFAULT 'missed',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    duration INTEGER DEFAULT 0,
    FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Index pour améliorer les performances
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_participants_conversation ON conversation_participants(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
  CREATE INDEX IF NOT EXISTS idx_saved_messages_user ON saved_messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id);
  CREATE INDEX IF NOT EXISTS idx_calls_receiver ON calls(receiver_id);
`);

// Ajouter les colonnes manquantes si elles n'existent pas
try {
  db.exec(`ALTER TABLE users ADD COLUMN show_phone INTEGER DEFAULT 0`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN show_last_seen INTEGER DEFAULT 1`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN show_profile_photo INTEGER DEFAULT 1`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN description TEXT DEFAULT ''`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN created_by TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`);
} catch (e) {}

// Créer la table des logs d'activité admin
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    admin_id TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_admin_logs_date ON admin_logs(created_at);
`);

// Définir Zeus comme admin (username = 'zeus' ou 'Zeus')
try {
  db.exec(`UPDATE users SET is_admin = 1 WHERE LOWER(username) = 'zeus'`);
} catch (e) {}

console.log('Base de données Anogram initialisée avec succès!');

module.exports = db;
