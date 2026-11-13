import { describe, expect, it } from "vitest";
import { generatePassword, hashPassword, MAX_PASSWORD_LENGTH, verifyPassword } from "./passwords";

describe("password hashing (scrypt)", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("Correct-Horse-7");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword("Correct-Horse-7", hash)).toBe(true);
    expect(await verifyPassword("correct-horse-7", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts every hash, so equal passwords never share a hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });

  it("treats Unicode compatibility forms of the same password as equal (NFKC)", async () => {
    const hash = await hashPassword("Abc1-żółć");
    // Full-width letters/digits only match after NFKC (NFC alone keeps them distinct) ...
    expect(await verifyPassword("Ａｂｃ１-żółć", hash)).toBe(true);
    // ... and decomposed Polish letters (z + combining dot, o + combining acute) match too.
    expect(await verifyPassword("Abc1-żółć", hash)).toBe(true);
  });

  it("rejects stored hashes with an oversized salt or key", async () => {
    const big = Buffer.alloc(65, 1).toString("base64url");
    const ok = Buffer.alloc(32, 1).toString("base64url");
    expect(await verifyPassword("x", `scrypt$32768$8$1$${big}$${ok}`)).toBe(false);
    expect(await verifyPassword("x", `scrypt$32768$8$1$${ok}$${big}`)).toBe(false);
  });

  it.each([
    ["not a hash"],
    ["scrypt$32768$8$1$c2FsdA$aGFzaA"],
    ["bcrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["scrypt$1048576$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["scrypt$30000$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["scrypt$32768$99$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  ])("a malformed or out-of-range stored hash never matches: %s", async (stored) => {
    expect(await verifyPassword("anything", stored)).toBe(false);
  });

  it("refuses empty and oversized passwords", async () => {
    await expect(hashPassword("")).rejects.toThrow(RangeError);
    await expect(hashPassword("x".repeat(MAX_PASSWORD_LENGTH + 1))).rejects.toThrow(RangeError);
    expect(await verifyPassword("x".repeat(MAX_PASSWORD_LENGTH + 1), await hashPassword("x"))).toBe(false);
  });

  it("generates long random passwords without look-alike characters", () => {
    const passwords = Array.from({ length: 50 }, () => generatePassword());
    for (const p of passwords) expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
    expect(new Set(passwords).size).toBe(passwords.length);
  });
});
