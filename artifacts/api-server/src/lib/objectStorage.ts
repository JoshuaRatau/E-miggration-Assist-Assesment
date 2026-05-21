import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";
import { logger } from "./logger";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * Minimal handle returned by both backends so routes can stream + read
 * metadata uniformly. GCS's `File` already satisfies this structurally;
 * `S3ObjectHandle` mimics it.
 */
export interface StoredFileHandle {
  name: string;
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[{ contentType?: string; size?: number | string }]>;
  createReadStream(): Readable;
}

// =====================================================================
// S3 backend (production only, when NODE_ENV=production && S3_BUCKET set)
// =====================================================================

let cachedS3:
  | { client: S3Client; bucket: string; region: string; privatePrefix: string; publicPrefix: string; loggedActive: boolean }
  | null = null;

function loadS3Backend(): {
  client: S3Client;
  bucket: string;
  region: string;
  privatePrefix: string;
  publicPrefix: string;
} | null {
  if (cachedS3) return cachedS3;
  if (process.env.NODE_ENV !== "production") return null;
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) return null;
  const region = (process.env.AWS_REGION || "af-south-1").trim();

  // Optional prefixes — leave empty for keys to match `/objects/<entityId>`
  // 1:1 (entityId stored in lead_documents.file_url). Provided so the same
  // bucket can be partitioned per-environment if needed.
  const privatePrefix = normalizePrefix(process.env.S3_PRIVATE_PREFIX);
  const publicPrefix = normalizePrefix(process.env.S3_PUBLIC_PREFIX);

  // AWS SDK reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from env by
  // default; on EC2 with an attached IAM role it picks up instance creds.
  const client = new S3Client({ region });
  cachedS3 = { client, bucket, region, privatePrefix, publicPrefix, loggedActive: false };
  return cachedS3;
}

function normalizePrefix(raw: string | undefined): string {
  const v = (raw || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return v ? `${v}/` : "";
}

function logProviderOnce(provider: "s3" | "replit") {
  if (provider === "s3") {
    if (cachedS3 && !cachedS3.loggedActive) {
      logger.info(
        { provider: "s3", bucket: cachedS3.bucket, region: cachedS3.region },
        "Object storage provider active: S3",
      );
      cachedS3.loggedActive = true;
    }
  } else {
    if (!replitProviderLogged) {
      logger.info({ provider: "replit" }, "Object storage provider active: Replit Object Storage");
      replitProviderLogged = true;
    }
  }
}

let replitProviderLogged = false;

class S3ObjectHandle implements StoredFileHandle {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    public readonly name: string,
  ) {}

  async exists(): Promise<[boolean]> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.name }));
      return [true];
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (name === "NotFound" || name === "NoSuchKey" || status === 404) return [false];
      throw err;
    }
  }

  async getMetadata(): Promise<[{ contentType?: string; size?: number | string }]> {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: this.name }),
    );
    return [{ contentType: head.ContentType, size: head.ContentLength }];
  }

  createReadStream(): Readable {
    // Lazy-pull: defer to a passthrough that resolves the GetObject body on
    // first read. Callers `.pipe(res)` which is fine with a Readable.
    const passthrough = new Readable({ read() {} });
    this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: this.name }))
      .then((out) => {
        const body = out.Body as Readable | undefined;
        if (!body) {
          passthrough.destroy(new ObjectNotFoundError());
          return;
        }
        body.on("data", (chunk) => passthrough.push(chunk));
        body.on("end", () => passthrough.push(null));
        body.on("error", (err) => passthrough.destroy(err));
      })
      .catch((err) => passthrough.destroy(err));
    return passthrough;
  }
}

// =====================================================================
// Public service — branches between GCS (Replit) and S3 (production)
// =====================================================================

export class ObjectStorageService {
  constructor() {}

  // ---- shared config readers ----

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  // ---- public asset search/download ----

  async searchPublicObject(filePath: string): Promise<StoredFileHandle | null> {
    const s3 = loadS3Backend();
    if (s3) {
      logProviderOnce("s3");
      const key = `${s3.publicPrefix}${filePath.replace(/^\/+/, "")}`;
      const handle = new S3ObjectHandle(s3.client, s3.bucket, key);
      const [exists] = await handle.exists();
      return exists ? handle : null;
    }

    logProviderOnce("replit");
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) return file as unknown as StoredFileHandle;
    }
    return null;
  }

  async downloadObject(
    file: StoredFileHandle,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();

    // ACL lookup only meaningful on the GCS path (Replit Object Storage).
    // S3 deployments rely on Express route auth (admin sessions, lead-scope
    // checks) — every object served via this code is treated as private.
    let isPublic = false;
    if (file instanceof File) {
      const aclPolicy = await getObjectAclPolicy(file);
      isPublic = aclPolicy?.visibility === "public";
    }

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size !== undefined) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  // ---- private upload + retrieval ----

  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    const entityKey = `uploads/${objectId}`;

    const s3 = loadS3Backend();
    if (s3) {
      logProviderOnce("s3");
      const key = `${s3.privatePrefix}${entityKey}`;
      const cmd = new PutObjectCommand({ Bucket: s3.bucket, Key: key });
      return getSignedUrl(s3.client, cmd, { expiresIn: 900 });
    }

    logProviderOnce("replit");
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    const fullPath = `${privateObjectDir}/${entityKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredFileHandle> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    // entityId is everything after the "/objects/" prefix — e.g. "uploads/<uuid>".
    // This is the stable key stored in lead_documents.file_url and survives
    // a backend swap as long as new uploads use the same layout.
    const entityId = parts.slice(1).join("/");

    const s3 = loadS3Backend();
    if (s3) {
      logProviderOnce("s3");
      const key = `${s3.privatePrefix}${entityId}`;
      const handle = new S3ObjectHandle(s3.client, s3.bucket, key);
      const [exists] = await handle.exists();
      if (!exists) throw new ObjectNotFoundError();
      return handle;
    }

    logProviderOnce("replit");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return objectFile as unknown as StoredFileHandle;
  }

  /**
   * Convert the raw URL the browser uploaded to into the canonical
   * `/objects/<entityId>` path that is persisted in the DB. Recognises:
   *   • GCS:  https://storage.googleapis.com/<bucket>/<privateDir>/<entityId>?...
   *   • S3:   https://<bucket>.s3.<region>.amazonaws.com/<privatePrefix><entityId>?...
   *           https://s3.<region>.amazonaws.com/<bucket>/<privatePrefix><entityId>?...
   */
  normalizeObjectEntityPath(rawPath: string): string {
    // S3 path-style or virtual-host-style URLs.
    const s3 = loadS3Backend();
    if (s3) {
      try {
        const url = new URL(rawPath);
        if (
          url.hostname === `${s3.bucket}.s3.${s3.region}.amazonaws.com` ||
          url.hostname === `s3.${s3.region}.amazonaws.com` ||
          url.hostname.endsWith(".amazonaws.com")
        ) {
          let key = url.pathname.replace(/^\/+/, "");
          // path-style includes the bucket name as the first segment
          if (key.startsWith(`${s3.bucket}/`)) key = key.slice(s3.bucket.length + 1);
          if (s3.privatePrefix && key.startsWith(s3.privatePrefix)) {
            key = key.slice(s3.privatePrefix.length);
          }
          return `/objects/${key}`;
        }
      } catch {
        /* not a URL, fall through */
      }
    }

    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) objectEntityDir = `${objectEntityDir}/`;
    if (!rawObjectPath.startsWith(objectEntityDir)) return rawObjectPath;
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  /**
   * Delete a stored object (best-effort). Currently unused by routes but
   * provided so future cleanup logic has one entry point.
   */
  async deleteObjectEntity(objectPath: string): Promise<void> {
    if (!objectPath.startsWith("/objects/")) return;
    const entityId = objectPath.slice("/objects/".length);

    const s3 = loadS3Backend();
    if (s3) {
      logProviderOnce("s3");
      const key = `${s3.privatePrefix}${entityId}`;
      try {
        await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
      } catch (err) {
        logger.warn({ err, key }, "S3 delete failed");
      }
      return;
    }

    logProviderOnce("replit");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const { bucketName, objectName } = parseObjectPath(`${entityDir}${entityId}`);
    try {
      await objectStorageClient.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
    } catch (err) {
      logger.warn({ err, objectName }, "GCS delete failed");
    }
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) return normalizedPath;

    // S3 mode: ACL is route-enforced; no object-level metadata applied.
    if (loadS3Backend()) return normalizedPath;

    const handle = await this.getObjectEntityFile(normalizedPath);
    if (handle instanceof File) {
      await setObjectAclPolicy(handle, aclPolicy);
    }
    return normalizedPath;
  }

  /**
   * Phase 6D-2 — Upload a small public asset (e.g. inline rich-editor
   * image). For GCS: writes under the FIRST configured public-search-path.
   * For S3: writes under `${S3_PUBLIC_PREFIX}<relativePath>`.
   */
  async uploadPublicAsset(
    relativePath: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const s3 = loadS3Backend();
    if (s3) {
      logProviderOnce("s3");
      const key = `${s3.publicPrefix}${relativePath.replace(/^\/+/, "")}`;
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      return;
    }

    logProviderOnce("replit");
    const searchPath = this.getPublicObjectSearchPaths()[0];
    if (!searchPath) throw new Error("PUBLIC_OBJECT_SEARCH_PATHS empty");
    const fullPath = `${searchPath.replace(/\/$/, "")}/${relativePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(body, {
      contentType,
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredFileHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    // S3 mode: gate at the route layer (admin auth + lead scope), not at
    // object metadata. Every authenticated download is allowed here.
    if (loadS3Backend()) return true;
    if (!(objectFile instanceof File)) return true;
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");
  return { bucketName, objectName };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }
  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}
