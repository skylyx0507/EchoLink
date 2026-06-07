import jwt from "jsonwebtoken";

export interface TokenPayload {
  userId: number;
  username: string;
  roomId?: string;
}

export function generateToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    return jwt.verify(token, secret) as TokenPayload;
  } catch {
    return null;
  }
}
