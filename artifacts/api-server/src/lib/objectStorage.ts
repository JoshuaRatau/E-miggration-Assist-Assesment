import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

// Strict gate: S3 only activates on production EC2 with explicit opt-in.
// Replit dev + Replit deployment keep using Replit Object Storage even if
// AWS_* secrets happen to be present.
const useS3 =
  process.env.NODE_ENV === "production" &&
  process.env.STORAGE_PROVIDER === "s3" &&
  !!process.env.S3_BUCKET;

const S3_REGION = process.env.AWS_REGION || "af-south-1";
const S3_BUCKET = process.env.S3_BUCKET || "";

const s3 = useS3
  ? new S3Client({
      region: S3_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  : null;

/**
 * Minimal file-handle returned by getObjectEntityFile / searchPublicObject
 * in S3 mode. Implements the subset of GCS File methods that routes and
 * downloadObject actually use (getMetadata, createReadStream, exists, name).
 */
class S3FileHandle {
  constructor(
    public readonly name: string,
    private readonly bucket: string,
  ) {}

  async exists(): Promise<[boolean]> {
    try {
      await s3!.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.name }));
      return [true];
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
        return [false];
      }
      throw err;
    }
  }

  async getMetadata(): Promise<[{ contentType?: string; size?: number }]> {
    const head = await s3!.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.name }));
    return [{ contentType: head.ContentType, size: head.ContentLength }];
  }

  createReadStream(): Readable {
    const pass = new Readable({ read() {} });
    s3!
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: this.name }))
      .then((out) => {
        const body = out.Body as Readable | undefined;
        if (!body) {
          pass.destroy(new ObjectNotFoundError());
          return;
        }
        body.on("data", (c) => pass.push(c));
        body.on("end", () => pass.push(null));
        body.on("error", (err) => pass.destroy(err));
      })
      .catch((err) => pass.destroy(err));
    return pass;
  }
}

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

export class ObjectStorageService {
  constructor() {}

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

  async searchPublicObject(filePath: string): Promise<File | S3FileHandle | null> {
    // Production EC2 → S3
    if (s3) {
      const handle = new S3FileHandle(filePath.replace(/^\/+/, ""), S3_BUCKET);
      const [exists] = await handle.exists();
      return exists ? handle : null;
    }

    // Existing Replit behavior — DO NOT CHANGE
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File | S3FileHandle, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();

    // ACL only meaningful on the GCS path. S3 objects are gated at the
    // Express route layer (admin auth / lead-scope), so treat as private.
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
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    const entityKey = `uploads/${objectId}`;

    // Production EC2 → S3 (presigned PUT, 15 min)
    if (s3) {
      const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: entityKey });
      return getSignedUrl(s3, cmd, { expiresIn: 900 });
    }

    // Existing Replit behavior — DO NOT CHANGE
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

  async getObjectEntityFile(objectPath: string): Promise<File | S3FileHandle> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    // entityId stays identical across backends (e.g. "uploads/<uuid>"),
    // so existing lead_documents.file_url rows resolve in both modes.
    const entityId = parts.slice(1).join("/");

    // Production EC2 → S3
    if (s3) {
      const handle = new S3FileHandle(entityId, S3_BUCKET);
      const [exists] = await handle.exists();
      if (!exists) throw new ObjectNotFoundError();
      return handle;
    }

    // Existing Replit behavior — DO NOT CHANGE
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    // Production EC2 → recognise S3 presigned-URL shapes and collapse
    // them to the canonical `/objects/<entityId>` form that the DB stores.
    if (s3) {
      try {
        const url = new URL(rawPath);
        const isVirtualHost = url.hostname === `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
        const isPathStyle = url.hostname === `s3.${S3_REGION}.amazonaws.com`;
        if (isVirtualHost || isPathStyle) {
          let key = url.pathname.replace(/^\/+/, "");
          if (isPathStyle && key.startsWith(`${S3_BUCKET}/`)) {
            key = key.slice(S3_BUCKET.length + 1);
          }
          return `/objects/${key}`;
        }
      } catch {
        /* not a URL — fall through */
      }
    }

    // Existing Replit behavior — DO NOT CHANGE
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    // S3 mode has no per-object ACL — access is route-gated. Return early.
    if (s3) return normalizedPath;

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    if (objectFile instanceof File) {
      await setObjectAclPolicy(objectFile, aclPolicy);
    }
    return normalizedPath;
  }

  /**
   * Phase 6D-2 — Upload a small public asset (e.g. inline rich-editor
   * image) to the FIRST configured public-search-path. The returned
   * relative path is what `/api/public-assets/<path>` will serve.
   */
  async uploadPublicAsset(
    relativePath: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {

    // Production EC2 → S3
    if (s3) {
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: relativePath,
          Body: body,
          ContentType: contentType,
        })
      );

      return;
    }

    // Existing Replit behavior — DO NOT CHANGE
    const searchPath = this.getPublicObjectSearchPaths()[0];
    const fullPath = `${searchPath.replace(/\/$/, "")}/${relativePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const file = objectStorageClient
        .bucket(bucketName)
        .file(objectName);

    await file.save(body,{
      contentType,
      resumable:false,
      metadata:{
        contentType,
        cacheControl:"public, max-age=31536000, immutable",
      },
    });
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File | S3FileHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    // S3 mode: gated at the Express route layer (admin auth / lead scope).
    if (s3 || !(objectFile instanceof File)) return true;
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

  return {
    bucketName,
    objectName,
  };
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
      headers: {
        "Content-Type": "application/json",
      },
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
