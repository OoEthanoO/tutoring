// Encryption for database backups that leave finprint-host: AES-256-GCM with a
// key derived from a passphrase by scrypt. Layout: magic | salt(16) | iv(12) |
// ciphertext | tag(16). Any machine with Node can decrypt a copy with
// `node scripts/db-backup.mjs decrypt <in> <out>` and the passphrase.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = Buffer.from("YLDB1\n");
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const deriveKey = (passphrase, salt) => {
  if (!passphrase || passphrase.length < 12) throw new Error("The backup passphrase must be at least 12 characters.");
  return scryptSync(passphrase, salt, 32, SCRYPT);
};

export const encryptBackup = (plain, passphrase) => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]);
};

export const decryptBackup = (sealed, passphrase) => {
  if (sealed.length < MAGIC.length + 44 || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Not a YanLearn database backup.");
  }
  let at = MAGIC.length;
  const salt = sealed.subarray(at, (at += 16));
  const iv = sealed.subarray(at, (at += 12));
  const tag = sealed.subarray(sealed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  // A wrong passphrase or a damaged file fails the tag check here.
  return Buffer.concat([decipher.update(sealed.subarray(at, sealed.length - 16)), decipher.final()]);
};
