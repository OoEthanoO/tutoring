import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Class recordings live in an S3-compatible bucket, not in Supabase Storage:
 * the Supabase Free tier caps files at 50 MB and the project at 1 GB, while a
 * single class is 60–120 MB. Cloudflare R2 (10 GB + free egress) and Backblaze
 * B2 (10 GB, no card needed) both fit in their free tiers; any S3-compatible
 * store works. Configure with:
 *
 *   RECORDINGS_S3_ENDPOINT            https://<account>.r2.cloudflarestorage.com
 *                                     or https://s3.<region>.backblazeb2.com
 *   RECORDINGS_S3_BUCKET              bucket name (create it private)
 *   RECORDINGS_S3_REGION              "auto" for R2, e.g. "us-west-004" for B2
 *   RECORDINGS_S3_ACCESS_KEY_ID
 *   RECORDINGS_S3_SECRET_ACCESS_KEY
 *
 * The bucket is never public: the app uploads through a presigned PUT and
 * viewers get a presigned GET that lives for two minutes.
 */

const endpoint = process.env.RECORDINGS_S3_ENDPOINT ?? "";
const region = process.env.RECORDINGS_S3_REGION || "auto";
const accessKeyId = process.env.RECORDINGS_S3_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.RECORDINGS_S3_SECRET_ACCESS_KEY ?? "";

export const recordingsBucket = process.env.RECORDINGS_S3_BUCKET ?? "class-recordings";

/** How long the desktop app has to finish PUTting a file. */
export const uploadUrlTtlSeconds = 2 * 60 * 60;

/** How long a viewer's presigned GET stays valid; each range request gets a fresh one. */
export const downloadUrlTtlSeconds = 120;

export const recordingStorageConfigured = (): boolean =>
  Boolean(endpoint && accessKeyId && secretAccessKey && recordingsBucket);

let client: S3Client | null = null;

const getClient = (): S3Client => {
  if (!recordingStorageConfigured()) {
    throw new Error(
      "Recording storage is not configured (RECORDINGS_S3_ENDPOINT / BUCKET / ACCESS_KEY_ID / SECRET_ACCESS_KEY)."
    );
  }
  if (!client) {
    client = new S3Client({
      region,
      endpoint,
      // Path-style works with R2, B2, MinIO, and AWS alike.
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
};

export const createRecordingUploadUrl = (key: string, contentType: string): Promise<string> =>
  getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: recordingsBucket, Key: key, ContentType: contentType }),
    { expiresIn: uploadUrlTtlSeconds }
  );

export const createRecordingDownloadUrl = (key: string, contentType: string): Promise<string> =>
  getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: recordingsBucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: "inline",
      ResponseCacheControl: "private, no-store",
    }),
    { expiresIn: downloadUrlTtlSeconds }
  );

/** Size of a stored object, or null when it does not exist. */
export const getRecordingObjectSize = async (key: string): Promise<number | null> => {
  try {
    const head = await getClient().send(
      new HeadObjectCommand({ Bucket: recordingsBucket, Key: key })
    );
    return typeof head.ContentLength === "number" ? head.ContentLength : 0;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (error as { name?: string })?.name ?? "";
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
};

/** Delete a stored object. Deleting a missing key is not an error. */
export const deleteRecordingObject = async (key: string): Promise<void> => {
  await getClient().send(new DeleteObjectCommand({ Bucket: recordingsBucket, Key: key }));
};
