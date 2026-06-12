import Database from "better-sqlite3";
import path from "path";

/**
 * SQLite database for persisting user accounts.
 *
 * Tables:
 * - users: local accounts with bcrypt password hashes.
 *
 * The database file path is configurable via DATABASE_PATH env var.
 * It defaults to a file next to the compiled entry (dist/echolink.db)
 * or the project root in development.
 */

const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, "../echolink.db");

const db = new Database(dbPath);

// Enable WAL for better concurrency and performance.
db.pragma("journal_mode = WAL");

// Initialize schema if not exists.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`);

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: number;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  displayName?: string;
}

export function createUser(input: CreateUserInput): User {
  const stmt = db.prepare(
    "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)"
  );
  const result = stmt.run(input.username, input.passwordHash, input.displayName || null);

  const user = findUserById(result.lastInsertRowid as number);
  if (!user) {
    throw new Error("Failed to create user");
  }
  return user;
}

export function findUserById(id: number): User | null {
  const row = db
    .prepare("SELECT id, username, password_hash, display_name, created_at FROM users WHERE id = ?")
    .get(id) as
    | { id: number; username: string; password_hash: string; display_name: string | null; created_at: number }
    | undefined;

  if (!row) return null;
  return mapRow(row);
}

export function findUserByUsername(username: string): User | null {
  const row = db
    .prepare(
      "SELECT id, username, password_hash, display_name, created_at FROM users WHERE username = ? COLLATE NOCASE"
    )
    .get(username) as
    | { id: number; username: string; password_hash: string; display_name: string | null; created_at: number }
    | undefined;

  if (!row) return null;
  return mapRow(row);
}

function mapRow(
  row: { id: number; username: string; password_hash: string; display_name: string | null; created_at: number }
): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}
