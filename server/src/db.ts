import fs from "fs";
import path from "path";
import crypto from "crypto";

interface User {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
}

interface Database {
  users: User[];
  nextId: number;
}

const DB_PATH = path.join(__dirname, "..", "data", "users.json");
let db: Database = { users: [], nextId: 1 };

export function initDatabase(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } else {
    saveDb();
  }
}

export function closeDatabase(): void {}

function saveDb(): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function createUser(username: string, password: string): { success: boolean; userId?: number; error?: string } {
  if (!username || !password) return { success: false, error: "用户名和密码不能为空" };
  if (username.length < 2 || username.length > 20) return { success: false, error: "用户名长度 2-20" };
  if (password.length < 4) return { success: false, error: "密码至少 4 位" };
  if (db.users.find((u) => u.username === username)) return { success: false, error: "用户名已存在" };

  const user: User = {
    id: db.nextId++,
    username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  saveDb();
  return { success: true, userId: user.id };
}

export function verifyUser(username: string, password: string): { success: boolean; user?: User } {
  const user = db.users.find((u) => u.username === username);
  if (!user) return { success: false };
  if (user.passwordHash !== hashPassword(password)) return { success: false };
  return { success: true, user };
}
