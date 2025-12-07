const { createClient } = require('@libsql/client');

// Configuration Turso
const TURSO_URL = process.env.TURSO_URL || 'libsql://anogram-zeus75017.aws-ap-south-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJleHAiOjE3NjU3NDg5MTIsImdpZCI6ImNlZmUyNGU0LTM5YWEtNDA2MC1iZDg1LTM2YzNmZDVmZWE4ZCIsImlhdCI6MTc2NTE0NDExMiwicmlkIjoiMmI1NDQ3OWQtMDRiZC00MGEzLWJjMTctODNlZWFkMTRiMTRjIn0.kbxKUZbrB4qxnNE1Qtp_JnaZFm6_66ADRgCy4YXQIiDNRRk2c0rv0BsihSmnoEfi5b97KHYmeKycG5_QEH7FAg';

console.log('Connexion à Turso:', TURSO_URL);

const turso = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

// Wrapper pour compatibilité avec better-sqlite3
class TursoWrapper {
  constructor(client) {
    this.client = client;
    this.statements = new Map();
  }

  // Exécuter du SQL directement
  async execAsync(sql) {
    const statements = sql.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          await this.client.execute(stmt);
        } catch (e) {
          // Ignorer les erreurs "already exists"
          if (!e.message.includes('already exists')) {
            console.error('SQL Error:', e.message);
          }
        }
      }
    }
  }

  exec(sql) {
    // Version synchrone pour compatibilité - lance en async
    this.execAsync(sql).catch(e => console.error('Exec error:', e));
  }

  // Préparer une requête
  prepare(sql) {
    return new TursoStatement(this.client, sql);
  }

  pragma(cmd) {
    // Les pragmas ne sont pas supportés de la même façon sur Turso
    console.log('Pragma ignoré:', cmd);
  }
}

class TursoStatement {
  constructor(client, sql) {
    this.client = client;
    this.sql = sql;
  }

  run(...params) {
    // Exécution synchrone simulée
    const args = this._formatParams(params);
    const result = { changes: 0, lastInsertRowid: 0 };

    this.client.execute({ sql: this.sql, args })
      .then(r => {
        result.changes = r.rowsAffected || 0;
        result.lastInsertRowid = r.lastInsertRowid || 0;
      })
      .catch(e => console.error('Run error:', e.message));

    return result;
  }

  async runAsync(...params) {
    const args = this._formatParams(params);
    const r = await this.client.execute({ sql: this.sql, args });
    return { changes: r.rowsAffected || 0, lastInsertRowid: r.lastInsertRowid || 0 };
  }

  get(...params) {
    // Pour get synchrone, on retourne undefined et on log
    console.warn('Utiliser getAsync() pour:', this.sql.substring(0, 50));
    return undefined;
  }

  async getAsync(...params) {
    const args = this._formatParams(params);
    const r = await this.client.execute({ sql: this.sql, args });
    return r.rows[0] ? this._rowToObject(r.rows[0], r.columns) : undefined;
  }

  all(...params) {
    console.warn('Utiliser allAsync() pour:', this.sql.substring(0, 50));
    return [];
  }

  async allAsync(...params) {
    const args = this._formatParams(params);
    const r = await this.client.execute({ sql: this.sql, args });
    return r.rows.map(row => this._rowToObject(row, r.columns));
  }

  _formatParams(params) {
    // Flatten si c'est un array dans un array
    if (params.length === 1 && Array.isArray(params[0])) {
      return params[0];
    }
    return params;
  }

  _rowToObject(row, columns) {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  }
}

// Initialisation de la base de données
async function initDatabase() {
  console.log('Initialisation de la base de données Turso...');

  await turso.execute(`
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
      show_phone INTEGER DEFAULT 0,
      show_last_seen INTEGER DEFAULT 1,
      show_profile_photo INTEGER DEFAULT 1,
      is_admin INTEGER DEFAULT 0
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'private',
      name TEXT,
      avatar TEXT,
      description TEXT DEFAULT '',
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS conversation_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, user_id)
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      read_by TEXT DEFAULT '[]',
      reply_to TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      nickname TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, contact_id)
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS saved_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, message_id)
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      caller_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      conversation_id TEXT,
      type TEXT DEFAULT 'audio',
      status TEXT DEFAULT 'missed',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      duration INTEGER DEFAULT 0
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      admin_id TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Créer les index
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)',
    'CREATE INDEX IF NOT EXISTS idx_participants_conversation ON conversation_participants(conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)',
    'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
    'CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_saved_messages_user ON saved_messages(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id)',
    'CREATE INDEX IF NOT EXISTS idx_calls_receiver ON calls(receiver_id)',
    'CREATE INDEX IF NOT EXISTS idx_admin_logs_date ON admin_logs(created_at)'
  ];

  for (const idx of indexes) {
    try {
      await turso.execute(idx);
    } catch (e) {
      // Index peut déjà exister
    }
  }

  // Définir les admins
  const adminUsernames = ['zeus', 'admin'];
  for (const username of adminUsernames) {
    try {
      await turso.execute({
        sql: 'UPDATE users SET is_admin = 1 WHERE LOWER(username) = ?',
        args: [username.toLowerCase()]
      });
    } catch (e) {}
  }

  console.log('Base de données Turso initialisée avec succès!');
}

const db = new TursoWrapper(turso);

module.exports = { db, turso, initDatabase };
