import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup } from "./dbBackupCrypto.mjs";

const passphrase = "correct horse battery staple";

describe("database backup encryption", () => {
  it("round-trips a dump", () => {
    const dump = randomBytes(100_000);
    expect(decryptBackup(encryptBackup(dump, passphrase), passphrase).equals(dump)).toBe(true);
  });

  it("never stores the plaintext and differs on every run", () => {
    const dump = Buffer.from("PGDMP secret rows");
    const first = encryptBackup(dump, passphrase);
    expect(first.includes(dump)).toBe(false);
    expect(first.equals(encryptBackup(dump, passphrase))).toBe(false);
  });

  it("rejects a wrong passphrase and a damaged file", () => {
    const sealed = encryptBackup(Buffer.from("PGDMP"), passphrase);
    expect(() => decryptBackup(sealed, "a different passphrase")).toThrow();
    const damaged = Buffer.from(sealed);
    damaged[damaged.length - 20] ^= 1;
    expect(() => decryptBackup(damaged, passphrase)).toThrow();
    expect(() => decryptBackup(Buffer.from("not a backup at all, clearly"), passphrase)).toThrow(/Not a YanLearn/);
  });

  it("refuses short passphrases", () => {
    expect(() => encryptBackup(Buffer.from("x"), "short")).toThrow(/at least 12/);
  });
});
