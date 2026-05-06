import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { db, prelaunchLeadsTable, prelaunchDocumentsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { writeAudit } from "../lib/audit";

// NOTE on auth: this app deliberately has no authentication layer (matching
// every other admin/leads endpoint in the API). Document UUIDs are random v4
// (~122 bits of entropy) and not exposed publicly, so they are unguessable in
// practice. If/when an admin auth layer is added, mount it on this router as
// well.

const uuidSchema = z.string().uuid();

const router: IRouter = Router();

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

// Expanded V2 document type list. The DB column is `text` so legacy values
// from earlier rows continue to display in admin without migration.
const ALLOWED_DOCUMENT_TYPES = new Set<string>([
  "passport",
  "visa_permit",
  "entry_stamp",
  "exit_stamp",
  "undesirable_declaration",
  "medical_evidence",
  "travel_evidence",
  "written_explanation",
  "id_document",
  "proof_of_address",
  "employment_letter",
  "financial_statement",
  "marriage_certificate",
  "birth_certificate",
  "other",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("UNSUPPORTED_TYPE"));
      return;
    }
    cb(null, true);
  },
});

function serializeDocument(
  row: typeof prelaunchDocumentsTable.$inferSelect,
) {
  return {
    id: row.id,
    leadId: row.leadId,
    documentType: row.documentType,
    fileUrl: row.fileUrl,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    uploadStatus: row.uploadStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

const objectStorage = new ObjectStorageService();

// Validate magic bytes match the declared mime to reject things like
// renamed executables. PDF -> "%PDF-", JPEG -> FFD8FF, PNG -> 89504E47.
async function isContentSafe(
  buffer: Buffer,
  declaredMime: string,
): Promise<boolean> {
  const sniffed = await fileTypeFromBuffer(buffer);
  if (!sniffed) {
    return false;
  }
  if (!ALLOWED_MIME_TYPES.has(sniffed.mime)) {
    return false;
  }
  // Treat image/jpg ↔ image/jpeg as equivalent
  const normalize = (m: string) =>
    m === "image/jpg" ? "image/jpeg" : m;
  return normalize(sniffed.mime) === normalize(declaredMime);
}

router.post(
  "/documents/upload",
  (req: Request, res: Response, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res
              .status(413)
              .json({ error: "File too large", maxBytes: MAX_FILE_BYTES });
          }
          return res
            .status(400)
            .json({ error: "Upload error", code: err.code });
        }
        if (err instanceof Error && err.message === "UNSUPPORTED_TYPE") {
          return res
            .status(415)
            .json({
              error:
                "Only PDF, JPG, PNG, DOC, and DOCX files are allowed",
            });
        }
        return next(err);
      }
      next();
    });
  },
  async (req, res) => {
    const file = req.file;
    const { leadId, documentType } = req.body as {
      leadId?: string;
      documentType?: string;
    };

    if (!file) {
      return res.status(400).json({ error: "Missing file" });
    }
    const parsedLeadId = uuidSchema.safeParse(leadId);
    if (!parsedLeadId.success) {
      return res.status(400).json({ error: "Invalid leadId" });
    }
    if (!documentType || !ALLOWED_DOCUMENT_TYPES.has(documentType)) {
      return res.status(400).json({ error: "Invalid documentType" });
    }

    // Confirm the lead exists before attaching the upload
    const leadRows = await db
      .select({ id: prelaunchLeadsTable.id })
      .from(prelaunchLeadsTable)
      .where(eq(prelaunchLeadsTable.id, parsedLeadId.data))
      .limit(1);
    if (leadRows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    // Magic byte verification — reject content that doesn't match its claim
    const safe = await isContentSafe(file.buffer, file.mimetype);
    if (!safe) {
      req.log.warn(
        { leadId, declaredMime: file.mimetype, name: file.originalname },
        "Rejected upload — magic bytes do not match declared mime",
      );
      return res
        .status(415)
        .json({ error: "File contents do not match the declared type" });
    }

    // Upload to object storage via presigned URL (server-side PUT)
    let normalizedPath: string;
    try {
      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.mimetype },
        body: file.buffer,
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => "");
        req.log.error(
          { status: putRes.status, body: text.slice(0, 300) },
          "GCS upload failed",
        );
        return res.status(502).json({ error: "Upload to storage failed" });
      }
      // Strip query string then normalize to /objects/<id>
      const cleanURL = uploadURL.split("?")[0]!;
      normalizedPath = objectStorage.normalizeObjectEntityPath(cleanURL);
    } catch (err) {
      req.log.error({ err }, "Unexpected storage error");
      return res.status(500).json({ error: "Storage error" });
    }

    const [inserted] = await db
      .insert(prelaunchDocumentsTable)
      .values({
        leadId: parsedLeadId.data,
        documentType,
        fileUrl: normalizedPath,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadStatus: "UPLOADED",
      })
      .returning();

    if (!inserted) {
      return res.status(500).json({ error: "Could not save document record" });
    }

    return res.status(201).json({
      success: true,
      ...serializeDocument(inserted),
    });
  },
);

router.get("/documents", async (req, res) => {
  const parsed = uuidSchema.safeParse(req.query.leadId);
  if (!parsed.success) {
    return res.status(400).json({ error: "leadId must be a valid UUID" });
  }
  const rows = await db
    .select()
    .from(prelaunchDocumentsTable)
    .where(eq(prelaunchDocumentsTable.leadId, parsed.data))
    .orderBy(desc(prelaunchDocumentsTable.createdAt));
  return res.json(rows.map(serializeDocument));
});

router.delete("/documents/:id", async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid document id" });
  }
  // `leadId` scope is REQUIRED for this public route — there is no auth
  // boundary so without it a leaked document UUID would be a global
  // delete-by-id primitive. Admin/back-office deletion is intentionally
  // not exposed here; if needed, build a separate admin-token-gated
  // route for that.
  const scopeLeadId =
    typeof req.body?.leadId === "string"
      ? req.body.leadId
      : typeof req.query.leadId === "string"
        ? req.query.leadId
        : null;
  if (!scopeLeadId) {
    return res.status(400).json({ error: "leadId scope is required" });
  }
  const parsedScope = uuidSchema.safeParse(scopeLeadId);
  if (!parsedScope.success) {
    return res.status(400).json({ error: "Invalid leadId scope" });
  }

  const deleted = await db
    .delete(prelaunchDocumentsTable)
    .where(
      and(
        eq(prelaunchDocumentsTable.id, parsedId.data),
        eq(prelaunchDocumentsTable.leadId, parsedScope.data),
      ),
    )
    .returning({ id: prelaunchDocumentsTable.id });

  if (deleted.length === 0) {
    return res.status(404).json({ error: "Document not found" });
  }

  // NOTE (V1 limitation): we delete the DB row but do NOT remove the
  // underlying object from storage. Orphaned blobs are tolerable for the
  // pre-launch volume; a future job can sweep them based on missing rows.
  return res.status(204).end();
});

router.get("/documents/:id/download", async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid document id" });
  }
  const id = parsedId.data;
  const rows = await db
    .select()
    .from(prelaunchDocumentsTable)
    .where(eq(prelaunchDocumentsTable.id, id))
    .limit(1);
  const doc = rows[0];
  if (!doc) {
    return res.status(404).json({ error: "Document not found" });
  }

  try {
    const objectFile = await objectStorage.getObjectEntityFile(doc.fileUrl);
    const [metadata] = await objectFile.getMetadata();
    const contentType =
      (metadata.contentType as string | undefined) ||
      doc.mimeType ||
      "application/octet-stream";
    const safeName = (doc.fileName ?? "document").replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=0, no-store");

    // Audit trail (fire-and-forget). Records every download attempt with
    // the actor's hashed credential — anonymous downloads (no admin
    // session, no x-admin-token) still create a row but with a null
    // hash so they are clearly distinguishable from operator activity.
    void writeAudit({
      req,
      action: "document_downloaded",
      leadId: doc.leadId,
      after: {
        documentId: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
      },
    });
    objectFile
      .createReadStream()
      .on("error", (err: unknown) => {
        req.log.error({ err, id }, "Stream error while serving document");
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy();
        }
      })
      .pipe(res);
    // Avoid Express trying to send another response after stream ends
    return undefined;
  } catch (err) {
    req.log.error({ err, id }, "Document download failed");
    return res.status(404).json({ error: "Document not available" });
  }
});

export default router;
