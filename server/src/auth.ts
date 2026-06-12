import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createUser, findUserByUsername, User } from "./db";

/**
 * Authentication module.
 *
 * - Passwords are hashed with bcrypt.
 * - JWT access tokens are used for both HTTP API and WebSocket authentication.
 * - JWT_SECRET and expiry are read from environment variables (no hard-coded secrets).
 */

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const BCRYPT_SALT_ROUNDS = 10;

export interface TokenPayload {
  userId: number;
  username: string;
  displayName: string | null;
}

export interface AuthResult {
  user: TokenPayload;
  token: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function ensureSecret(): void {
  if (!JWT_SECRET) {
    throw new AuthError("JWT_SECRET environment variable is not set");
  }
}

export async function register(
  username: string,
  password: string,
  displayName?: string
): Promise<AuthResult> {
  ensureSecret();

  const trimmedUsername = username.trim();
  const trimmedPassword = password.trim();

  if (!trimmedUsername || trimmedUsername.length < 3) {
    throw new AuthError("用户名至少需要 3 个字符");
  }
  if (!trimmedPassword || trimmedPassword.length < 6) {
    throw new AuthError("密码至少需要 6 个字符");
  }

  const existing = findUserByUsername(trimmedUsername);
  if (existing) {
    throw new AuthError("用户名已存在");
  }

  const passwordHash = await bcrypt.hash(trimmedPassword, BCRYPT_SALT_ROUNDS);
  const user = createUser({
    username: trimmedUsername,
    passwordHash,
    displayName: displayName?.trim(),
  });

  const token = signToken(user);
  return {
    user: toPayload(user),
    token,
  };
}

export async function login(username: string, password: string): Promise<AuthResult> {
  ensureSecret();

  const user = findUserByUsername(username.trim());
  if (!user) {
    throw new AuthError("用户名或密码错误");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AuthError("用户名或密码错误");
  }

  const token = signToken(user);
  return {
    user: toPayload(user),
    token,
  };
}

export function verifyToken(token: string): TokenPayload {
  ensureSecret();

  try {
    const decoded = jwt.verify(token, JWT_SECRET!) as TokenPayload;
    return decoded;
  } catch {
    throw new AuthError("无效的 token");
  }
}

function signToken(user: User): string {
  return jwt.sign(toPayload(user), JWT_SECRET!, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

function toPayload(user: User): TokenPayload {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
  };
}
