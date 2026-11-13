import "server-only";
import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password hashing for the test / demo password login. Node's built-in scrypt (memory-hard),
// no extra dependency. Stored format: scrypt$N$r$p$<salt>$<hash>, salt and hash base64url.

const COST = 2 ** 15; // N
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Accepted parameter range when verifying, so a tampered row cannot make verification hang.
const MIN_COST = 2 ** 14;
const MAX_COST = 2 ** 17;
const MAX_BLOCK_SIZE = 16;
const MAX_PARALLELISM = 4;
const MAX_STORED_BYTES = 64; // salt and key; longer values only come from a tampered row

/** Longest password accepted anywhere; stops megabyte inputs from reaching scrypt. */
export const MAX_PASSWORD_LENGTH = 200;

// No look-alike characters (0/O, 1/l/I), so a password can be read off a screen.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const GENERATED_LENGTH = 20; // ~116 bits of entropy

function derive(password: string, salt: Buffer, options: ScryptOptions, keyLength: number): Promise<Buffer> {
  // scrypt needs 128 * N * r bytes; allow twice that before Node refuses.
  const maxmem = 256 * (options.N ?? COST) * (options.r ?? BLOCK_SIZE);
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLength, { ...options, maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`Password must be 1-${MAX_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { N: COST, r: BLOCK_SIZE, p: PARALLELISM }, KEY_BYTES);
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("base64url"), key.toString("base64url")].join("$");
}

interface ParsedHash {
  options: { N: number; r: number; p: number };
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const isPowerOfTwo = Number.isInteger(N) && N > 0 && (N & (N - 1)) === 0;
  if (!isPowerOfTwo || N < MIN_COST || N > MAX_COST) return null;
  if (!Number.isInteger(r) || r < 1 || r > MAX_BLOCK_SIZE) return null;
  if (!Number.isInteger(p) || p < 1 || p > MAX_PARALLELISM) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");
  if (salt.length < SALT_BYTES || salt.length > MAX_STORED_BYTES) return null;
  if (key.length < KEY_BYTES || key.length > MAX_STORED_BYTES) return null;
  return { options: { N, r, p }, salt, key };
}

/** Constant-time check. A malformed stored hash never matches (and never throws). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const candidate = await derive(password, parsed.salt, parsed.options, parsed.key.length);
  return timingSafeEqual(candidate, parsed.key);
}

/** Random password for test accounts, from a cryptographic RNG. */
export function generatePassword(length = GENERATED_LENGTH): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
