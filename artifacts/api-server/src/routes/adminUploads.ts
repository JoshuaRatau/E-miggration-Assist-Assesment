import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "crypto";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAdminAuth } from "../lib/adminAuth";
import { writeAudit } from "../lib/audit";

// Phase 6D-2 — Inline image upload for the rich email editor.
//
// Endpoints:
//   POST /api/admin/uploads/image      (admin auth, multipart, returns {url})
//   GET  /api/public-assets/*          (unauthenticated, served from
//                                       PUBLIC_OBJECT_SEARCH_PATHS — required
//                                       so emails reach external inboxes)
//
// Trade-off: we use multipart→server→GCS instead of presigned URLs because
// these are small inline assets (banners, screenshots) not large file
// transfers. The single round-trip + magic-byte check is simpler and matches
// the existing `routes/documents.ts` pattern.

const router: IRouter = Router();

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 1,
    // 6D-2 hardening — bound multipart parsing surface so an authenticated
    // caller can't force avoidable memory/CPU pressure with junk fields.
    parts: 4,
    fields: 2,
    fieldSize: 1024,
    headerPairs: 32,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      cb(new Error("UNSUPPORTED_TYPE"));
      return;
    }
    cb(null, true);
  },
});

const objectStorage = new ObjectStorageService();

router.post(
  "/admin/uploads/image",
  async (req: Request, res: Response, next) => {
    if (!(await requireAdminAuth(req, res))) return;
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res
              .status(413)
              .json({ error: "File too large", maxBytes: MAX_IMAGE_BYTES });
          }
          return res.status(400).json({ error: "Upload error", code: err.code });
        }
        if (err instanceof Error && err.message === "UNSUPPORTED_TYPE") {
          return res
            .status(415)
            .json({ error: "Only JPG, PNG, WebP, and GIF images are allowed" });
        }
        return next(err);
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    // Magic-byte verification — protects against renamed payloads.
    const sniffed = await fileTypeFromBuffer(file.buffer);
    if (!sniffed || !ALLOWED_IMAGE_MIMES.has(sniffed.mime)) {
      res.status(415).json({ error: "Unrecognised image content" });
      return;
    }
    const ext = EXT_FOR_MIME[sniffed.mime];
    const filename = `${randomUUID()}.${ext}`;
    const relativePath = `comm-images/${filename}`;
    try {
      await objectStorage.uploadPublicAsset(
        relativePath,
        file.buffer,
        sniffed.mime,
      );
    } catch (e) {
      req.log.error({ err: e }, "uploadPublicAsset_failed");
      res.status(500).json({ error: "Upload failed" });
      return;
    }
    await writeAudit({
      req,
      action: "comm_image_uploaded",
      after: { path: relativePath, bytes: file.size, mime: sniffed.mime },
    });
    const url = `/api/public-assets/${relativePath}`;
    res.status(201).json({ url, path: relativePath });
  },
);

// Public, unauthenticated GET — emails sent to external inboxes need this.
router.get("/public-assets/{*splat}", async (req: Request, res: Response) => {
  const splat = (req.params as { splat?: string | string[] }).splat;
  const filePath = Array.isArray(splat) ? splat.join("/") : (splat ?? "");
  if (!filePath || filePath.includes("..")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  try {
    const file = await objectStorage.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const response = await objectStorage.downloadObject(file, 31536000);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (e) {
    if (e instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    req.log.error({ err: e }, "public_asset_serve_failed");
    res.status(500).json({ error: "Serve failed" });
  }
});

export default router;
