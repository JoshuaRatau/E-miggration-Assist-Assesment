import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Upload, FileText, Download, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const DOCUMENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "passport", label: "Passport" },
  { value: "visa_permit", label: "Visa / Permit" },
  { value: "entry_stamp", label: "Entry Stamp" },
  { value: "exit_stamp", label: "Exit Stamp" },
  { value: "undesirable_declaration", label: "Undesirable Declaration" },
  { value: "medical_evidence", label: "Medical Evidence" },
  { value: "travel_evidence", label: "Travel Evidence" },
  { value: "written_explanation", label: "Written Explanation" },
  { value: "other", label: "Other" },
];

const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];
const MAX_BYTES = 10 * 1024 * 1024;

type DocumentRow = {
  id: string;
  leadId: string;
  documentType: string;
  fileUrl: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  uploadStatus: string;
  createdAt: string;
};

function humanSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function labelForType(value: string): string {
  return (
    DOCUMENT_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value
  );
}

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchDocuments(leadId: string): Promise<DocumentRow[]> {
  const res = await fetch(
    `${BASE_URL}/api/documents?leadId=${encodeURIComponent(leadId)}`,
  );
  if (!res.ok) throw new Error("Failed to load documents");
  return res.json();
}

interface DocumentUploaderProps {
  leadId: string;
  /** When true, hides the in-component documents list (useful when a parent renders its own list). */
  hideList?: boolean;
}

export function DocumentUploader({
  leadId,
  hideList = false,
}: DocumentUploaderProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [docType, setDocType] = useState<string>("passport");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const queryKey = ["documents", leadId];
  const { data: docs = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchDocuments(leadId),
    enabled: Boolean(leadId),
  });

  const handleUpload = useCallback(
    async (file: File) => {
      setErrorMsg(null);

      // Client-side validation (server also re-validates)
      const ext = file.name
        .slice(file.name.lastIndexOf("."))
        .toLowerCase();
      if (!ALLOWED_MIME.includes(file.type) || !ALLOWED_EXT.includes(ext)) {
        setErrorMsg("Only PDF, JPG, and PNG files are accepted.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setErrorMsg("File is larger than the 10MB limit.");
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("leadId", leadId);
      formData.append("documentType", docType);

      setIsUploading(true);
      setProgress(0);

      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${BASE_URL}/api/documents/upload`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          setIsUploading(false);
          if (xhr.status >= 200 && xhr.status < 300) {
            toast({
              title: "Document uploaded",
              description: file.name,
            });
            qc.invalidateQueries({ queryKey });
          } else {
            let msg = "Upload failed.";
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed?.error) msg = parsed.error;
            } catch {
              /* ignore */
            }
            setErrorMsg(msg);
          }
          resolve();
        };
        xhr.onerror = () => {
          setIsUploading(false);
          setErrorMsg("Network error during upload.");
          resolve();
        };
        xhr.send(formData);
      });

      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [docType, leadId, qc, queryKey, toast],
  );

  const onPickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    void handleUpload(files[0]!);
  };

  return (
    <div className="space-y-6" data-testid="document-uploader">
      <div className="space-y-2">
        <label className="text-sm font-medium">Document type</label>
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger
            className="md:w-72"
            data-testid="select-document-type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOCUMENT_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          onPickFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed transition-colors p-8 text-center cursor-pointer ${
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30"
        } ${isUploading ? "opacity-70 pointer-events-none" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        data-testid="dropzone"
      >
        <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          {isDragOver
            ? "Release to upload"
            : "Drag a file here or click to browse"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF, JPG or PNG · up to 10MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => onPickFiles(e.target.files)}
          data-testid="input-file"
        />
      </Card>

      {isUploading && (
        <div className="space-y-2" data-testid="progress-container">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
            </span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {errorMsg && (
        <div
          className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md p-3"
          data-testid="error-message"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {!hideList && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Uploaded documents</h3>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No documents uploaded yet.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="documents-list">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-md border bg-card"
                  data-testid={`document-item-${d.id}`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {d.fileName ?? "Untitled"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {labelForType(d.documentType)} ·{" "}
                        {humanSize(d.fileSize)} · uploaded{" "}
                        {format(new Date(d.createdAt), "MMM d yyyy, HH:mm")}
                      </p>
                    </div>
                  </div>
                  <a
                    href={`${BASE_URL}/api/documents/${d.id}/download`}
                    className="shrink-0"
                    data-testid={`button-download-${d.id}`}
                  >
                    <Button size="sm" variant="ghost">
                      <Download className="h-4 w-4 mr-1" /> Download
                    </Button>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Files are stored privately and linked to your reference record only.
      </p>
    </div>
  );
}
