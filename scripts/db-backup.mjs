// The offsite half of database backups; deploy/windows/backup-db.ps1 runs the
// bundled copy (db-backup.cjs, built at postbuild like zen-gateway.cjs).
//   upload <file> <name>    encrypt <file>, store it as db-backups/<name>.enc and
//                           delete copies older than DB_BACKUP_KEEP_DAYS (60),
//                           except under db-backups/archive/
//   latest                  print the newest regular copy's name
//   download <name> <out>   fetch db-backups/<name>.enc and decrypt it to <out>
//   decrypt <in> <out>      decrypt a downloaded copy; needs no bucket access
// The bucket is the recordings bucket (RECORDINGS_S3_*); the passphrase is
// DB_BACKUP_PASSPHRASE.
import { readFileSync, writeFileSync } from "node:fs";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { decryptBackup, encryptBackup } from "./dbBackupCrypto.mjs";

const PREFIX = "db-backups/";
const ARCHIVE = `${PREFIX}archive/`;

const openBucket = () => {
  const { RECORDINGS_S3_ENDPOINT: endpoint, RECORDINGS_S3_ACCESS_KEY_ID: accessKeyId,
    RECORDINGS_S3_SECRET_ACCESS_KEY: secretAccessKey, RECORDINGS_S3_BUCKET: Bucket } = process.env;
  if (!endpoint || !accessKeyId || !secretAccessKey || !Bucket) throw new Error("The RECORDINGS_S3_* settings are incomplete.");
  // Same client settings as src/lib/recordingStorage.ts.
  const client = new S3Client({
    region: process.env.RECORDINGS_S3_REGION || "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, Bucket };
};

const listCopies = async ({ client, Bucket }) => {
  const items = [];
  let ContinuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: PREFIX, ContinuationToken }));
    items.push(...(page.Contents ?? []));
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return items;
};

const passphrase = () => process.env.DB_BACKUP_PASSPHRASE ?? "";

const commands = {
  async upload(file, name) {
    const bucket = openBucket();
    const sealed = encryptBackup(readFileSync(file), passphrase());
    const Key = `${PREFIX}${name}.enc`;
    await bucket.client.send(new PutObjectCommand({ Bucket: bucket.Bucket, Key, Body: sealed, ContentType: "application/octet-stream" }));
    const stored = await bucket.client.send(new HeadObjectCommand({ Bucket: bucket.Bucket, Key }));
    if (stored.ContentLength !== sealed.length) throw new Error(`Stored ${stored.ContentLength} bytes, sent ${sealed.length}.`);
    const cutoff = Date.now() - Number(process.env.DB_BACKUP_KEEP_DAYS ?? 60) * 86_400_000;
    let pruned = 0;
    for (const item of await listCopies(bucket)) {
      if (item.Key === Key || item.Key.startsWith(ARCHIVE) || !item.LastModified || item.LastModified.getTime() >= cutoff) continue;
      await bucket.client.send(new DeleteObjectCommand({ Bucket: bucket.Bucket, Key: item.Key }));
      pruned += 1;
    }
    console.log(JSON.stringify({ key: Key, bytes: sealed.length, pruned }));
  },
  async latest() {
    const copies = (await listCopies(openBucket())).filter((item) => !item.Key.startsWith(ARCHIVE) && item.Key.endsWith(".enc"));
    copies.sort((a, b) => b.LastModified - a.LastModified);
    if (!copies.length) throw new Error("No backups in the bucket.");
    console.log(copies[0].Key.slice(PREFIX.length, -".enc".length));
  },
  async download(name, out) {
    const bucket = openBucket();
    const object = await bucket.client.send(new GetObjectCommand({ Bucket: bucket.Bucket, Key: `${PREFIX}${name}.enc` }));
    const sealed = Buffer.from(await object.Body.transformToByteArray());
    writeFileSync(out, decryptBackup(sealed, passphrase()));
    console.log(JSON.stringify({ name, bytes: sealed.length }));
  },
  async decrypt(input, out) {
    writeFileSync(out, decryptBackup(readFileSync(input), passphrase()));
  },
};

const [command, ...args] = process.argv.slice(2);
if (!commands[command]) {
  console.error("Usage: db-backup upload <file> <name> | latest | download <name> <out> | decrypt <in> <out>");
  process.exit(2);
}
commands[command](...args).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
