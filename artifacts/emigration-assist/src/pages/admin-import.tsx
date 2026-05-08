import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin-layout";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type LeadType = "individual" | "professional";
type DedupeStrategy = "skip" | "update" | "create_anyway";

interface ImportJob {
  id: string;
  leadType: LeadType;
  status: string;
  rowsTotal: number;
  rowsValid: number | null;
  rowsInvalid: number | null;
  rowsImported: number | null;
  rowsUpdated: number | null;
  rowsSkippedDuplicate: number | null;
  sourceFilename: string;
  createdAt: string;
}
interface UploadResponse {
  job: ImportJob;
  columns: string[];
  suggestedMapping: Record<string, string | null>;
  availableFields: string[];
  maxRows: number;
}
interface PreviewRow {
  id: string;
  rowIndex: number;
  raw: Record<string, string>;
  parsed: Record<string, unknown> | null;
  status: "pending" | "valid" | "invalid" | "imported" | "skipped" | "failed";
  errors: Array<{ field: string; message: string }> | null;
}
interface CommitSummary {
  imported: number;
  updated: number;
  skippedDuplicate: number;
  invalid: number;
  total: number;
}

const FIELD_LABELS: Record<string, string> = {
  leadStatus: "Lead status",
  leadPriority: "Priority",
  adminNotes: "Admin notes",
  tags: "Tags (comma-separated)",
  fullName: "Full name",
  email: "Email",
  whatsapp: "WhatsApp / phone",
  nationality: "Nationality",
  countryOfResidence: "Country of residence",
  currentlyInSouthAfrica: "Currently in SA (yes/no)",
  passportStatus: "Passport status",
  visaHistory: "Visa history",
  immigrationSituation: "Immigration situation",
  visaExpiryDate: "Visa expiry (YYYY-MM-DD)",
  exitDate: "Exit date (YYYY-MM-DD)",
  overstayReason: "Overstay reason",
  preferredContactMethod: "Preferred contact method",
  organizationName: "Organisation name",
  organizationType: "Organisation type",
  representativeName: "Representative name",
  representativeEmail: "Representative email",
  representativePhone: "Representative phone",
  website: "Website",
  firmSize: "Firm size",
  operatingRegions: "Operating regions (comma-separated)",
  serviceFocus: "Service focus",
  estimatedClientVolume: "Estimated client volume (integer)",
};

type Step = "upload" | "map" | "preview" | "done";

export function AdminImport() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Read ?type= query param to preselect lead type. Falls back to individual.
  const initialLeadType = useMemo<LeadType>(() => {
    const qs = new URLSearchParams(window.location.search);
    const t = qs.get("type");
    return t === "professional" ? "professional" : "individual";
  }, []);

  const [step, setStep] = useState<Step>("upload");
  const [leadType, setLeadType] = useState<LeadType>(initialLeadType);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uploadResp, setUploadResp] = useState<UploadResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [dedupe, setDedupe] = useState<DedupeStrategy>("skip");

  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewFilter, setPreviewFilter] = useState<"valid" | "invalid">(
    "invalid",
  );

  const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Monotonic request id — every async wizard action snapshots this before
  // awaiting and refuses to mutate state if it has changed by the time the
  // promise resolves. `reset()`, `step` transitions, and "Start over" all
  // bump it, so an in-flight mapping/preview/commit can never resurrect an
  // abandoned job, overwrite the active filter's rows with a stale fetch,
  // or advance the step on the back of a failed preview load.
  const requestIdRef = useRef(0);

  function bumpRequestId(): number {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }

  // ─── Upload step ────────────────────────────────────────────────────────
  async function onUpload() {
    if (!file) {
      setError("Choose a CSV or XLSX file first.");
      return;
    }
    const myReq = bumpRequestId();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("leadType", leadType);
      const res = await fetch(`${BASE}/api/admin/imports`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json();
      if (myReq !== requestIdRef.current) return; // stale — user navigated away
      if (!res.ok) {
        throw new Error(json.message || json.error || "Upload failed");
      }
      const data = json as UploadResponse;
      setUploadResp(data);
      setMapping(data.suggestedMapping);
      setStep("map");
    } catch (e) {
      if (myReq !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      if (myReq === requestIdRef.current) setBusy(false);
    }
  }

  // ─── Map step ───────────────────────────────────────────────────────────
  async function onApplyMapping() {
    if (!uploadResp) return;
    const myReq = bumpRequestId();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${BASE}/api/admin/imports/${uploadResp.job.id}/mapping`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mapping, dedupeStrategy: dedupe }),
        },
      );
      const json = await res.json();
      if (myReq !== requestIdRef.current) return;
      if (!res.ok) {
        throw new Error(json.message || json.error || "Mapping failed");
      }
      setUploadResp({ ...uploadResp, job: json.job });
      // loadPreview throws on failure → catch-block surfaces the error and
      // we DO NOT advance to the preview step, so commit can never operate
      // against stale or empty preview data.
      await loadPreview(uploadResp.job.id, previewFilter, myReq);
      if (myReq !== requestIdRef.current) return;
      setStep("preview");
    } catch (e) {
      if (myReq !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Mapping failed");
    } finally {
      if (myReq === requestIdRef.current) setBusy(false);
    }
  }

  // ─── Preview step ───────────────────────────────────────────────────────
  // Throws on failure so callers (e.g. onApplyMapping) can choose NOT to
  // advance the wizard step. The reqId guard prevents an out-of-order
  // response from a slower old request from overwriting `previewRows`
  // after the user already switched filters or hit "Start over".
  async function loadPreview(
    jobId: string,
    status: "valid" | "invalid",
    reqId: number,
  ): Promise<void> {
    const res = await fetch(
      `${BASE}/api/admin/imports/${jobId}?limit=100&status=${status}`,
      { credentials: "include" },
    );
    const json = await res.json();
    if (reqId !== requestIdRef.current) return;
    if (!res.ok) {
      setPreviewRows([]);
      throw new Error(json.error || "Preview failed");
    }
    setPreviewRows(json.rows as PreviewRow[]);
  }
  useEffect(() => {
    if (step !== "preview" || !uploadResp) return;
    const myReq = bumpRequestId();
    loadPreview(uploadResp.job.id, previewFilter, myReq).catch((e) => {
      if (myReq !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Preview failed");
    });
  }, [previewFilter, step, uploadResp]);

  async function onCommit() {
    if (!uploadResp) return;
    const myReq = bumpRequestId();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${BASE}/api/admin/imports/${uploadResp.job.id}/commit`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      const json = await res.json();
      if (myReq !== requestIdRef.current) return;
      if (!res.ok) {
        throw new Error(json.message || json.error || "Commit failed");
      }
      setCommitSummary(json.summary as CommitSummary);
      setStep("done");
      toast({
        title: "Import complete",
        description: `${json.summary.imported} created · ${json.summary.updated} updated · ${json.summary.skippedDuplicate} skipped · ${json.summary.invalid} invalid`,
      });
    } catch (e) {
      if (myReq !== requestIdRef.current) return;
      const msg = e instanceof Error ? e.message : "Commit failed";
      setError(msg);
      toast({
        title: "Commit failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      if (myReq === requestIdRef.current) setBusy(false);
    }
  }

  function reset() {
    // Bump the request id so any pending upload/mapping/preview/commit
    // promise resolves into a no-op instead of resurrecting the abandoned
    // job's UI state.
    bumpRequestId();
    setStep("upload");
    setFile(null);
    setUploadResp(null);
    setMapping({});
    setDedupe("skip");
    setPreviewRows([]);
    setCommitSummary(null);
    setError(null);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <AdminLayout
      title="Imports"
      contentClassName="flex-1 container mx-auto max-w-5xl px-4 py-6"
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-2xl font-bold tracking-tight"
              data-testid="import-wizard-title"
            >
              Import leads
            </h1>
            <p className="text-sm text-muted-foreground">
              Upload a CSV or XLSX file, map its columns, preview, then commit.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => setLocation("/admin")}
            data-testid="import-back-to-admin"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to dashboard
          </Button>
        </div>

        <StepIndicator step={step} />

        {error && (
          <div
            className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="import-error"
          >
            {error}
          </div>
        )}

        {step === "upload" && (
          <Card className="p-6 space-y-6" data-testid="step-upload">
            <div className="space-y-3">
              <Label className="text-base font-semibold">
                What kind of leads are in this file?
              </Label>
              <RadioGroup
                value={leadType}
                onValueChange={(v) => setLeadType(v as LeadType)}
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              >
                <Label
                  htmlFor="lt-individual"
                  className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem
                    id="lt-individual"
                    value="individual"
                    data-testid="leadtype-individual"
                  />
                  <div>
                    <div className="font-medium">Individual (B2C)</div>
                    <div className="text-xs text-muted-foreground">
                      End users — visa applicants, overstay appeals, travel
                      assistance.
                    </div>
                  </div>
                </Label>
                <Label
                  htmlFor="lt-professional"
                  className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem
                    id="lt-professional"
                    value="professional"
                    data-testid="leadtype-professional"
                  />
                  <div>
                    <div className="font-medium">Professional (B2B)</div>
                    <div className="text-xs text-muted-foreground">
                      Law firms, immigration consultancies, mobility partners.
                    </div>
                  </div>
                </Label>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label htmlFor="file" className="text-base font-semibold">
                File
              </Label>
              <input
                ref={fileInputRef}
                id="file"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
                data-testid="import-file-input"
              />
              <p className="text-xs text-muted-foreground">
                CSV or Excel (.xlsx). Up to 10 MB and 5,000 rows. The first row
                must be a header.
              </p>
              {file && (
                <div className="flex items-center gap-2 text-sm">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span data-testid="import-file-name">{file.name}</span>
                  <span className="text-muted-foreground">
                    ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={onUpload}
                disabled={!file || busy}
                data-testid="import-upload-submit"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload &amp; continue
              </Button>
            </div>
          </Card>
        )}

        {step === "map" && uploadResp && (
          <Card className="p-6 space-y-6" data-testid="step-map">
            <div>
              <div className="text-sm text-muted-foreground">
                {uploadResp.job.rowsTotal} row(s) detected in{" "}
                <span className="font-medium text-foreground">
                  {uploadResp.job.sourceFilename}
                </span>
                . Map each spreadsheet column to a lead field, or leave it as
                <Badge variant="secondary" className="mx-1">
                  Ignore
                </Badge>
                to drop it onto the lead's tags.
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/2">Spreadsheet column</TableHead>
                    <TableHead>Maps to lead field</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadResp.columns.map((col) => (
                    <TableRow key={col} data-testid={`map-row-${col}`}>
                      <TableCell className="font-mono text-xs">{col}</TableCell>
                      <TableCell>
                        <Select
                          value={mapping[col] ?? "__ignore__"}
                          onValueChange={(v) =>
                            setMapping((m) => ({
                              ...m,
                              [col]: v === "__ignore__" ? null : v,
                            }))
                          }
                        >
                          <SelectTrigger
                            className="w-full"
                            data-testid={`map-select-${col}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__ignore__">
                              — Ignore (capture as tag) —
                            </SelectItem>
                            {uploadResp.availableFields.map((f) => (
                              <SelectItem key={f} value={f}>
                                {FIELD_LABELS[f] ?? f}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3">
              <Label className="text-base font-semibold">
                If a row matches an existing lead (by email or WhatsApp)…
              </Label>
              <RadioGroup
                value={dedupe}
                onValueChange={(v) => setDedupe(v as DedupeStrategy)}
                className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              >
                {(
                  [
                    {
                      v: "skip",
                      title: "Skip duplicates",
                      desc: "Don't touch existing leads. Recommended.",
                    },
                    {
                      v: "update",
                      title: "Update in place",
                      desc: "Overwrite existing fields with non-empty CSV values.",
                    },
                    {
                      v: "create_anyway",
                      title: "Always create new",
                      desc: "Insert every row even if it duplicates an existing lead.",
                    },
                  ] as Array<{ v: DedupeStrategy; title: string; desc: string }>
                ).map((opt) => (
                  <Label
                    key={opt.v}
                    htmlFor={`dd-${opt.v}`}
                    className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                  >
                    <RadioGroupItem
                      id={`dd-${opt.v}`}
                      value={opt.v}
                      data-testid={`dedupe-${opt.v}`}
                    />
                    <div>
                      <div className="font-medium text-sm">{opt.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {opt.desc}
                      </div>
                    </div>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            <div className="flex justify-between">
              <Button
                variant="ghost"
                onClick={reset}
                data-testid="import-back-to-upload"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Start over
              </Button>
              <Button
                onClick={onApplyMapping}
                disabled={busy}
                data-testid="import-apply-mapping"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                Validate &amp; preview
              </Button>
            </div>
          </Card>
        )}

        {step === "preview" && uploadResp && (
          <Card className="p-6 space-y-6" data-testid="step-preview">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Stat
                label="Total rows"
                value={uploadResp.job.rowsTotal}
                testid="stat-total"
              />
              <Stat
                label="Valid"
                value={uploadResp.job.rowsValid ?? 0}
                tone="positive"
                testid="stat-valid"
              />
              <Stat
                label="Invalid"
                value={uploadResp.job.rowsInvalid ?? 0}
                tone={
                  (uploadResp.job.rowsInvalid ?? 0) > 0 ? "negative" : "neutral"
                }
                testid="stat-invalid"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={previewFilter === "invalid" ? "default" : "outline"}
                  onClick={() => setPreviewFilter("invalid")}
                  data-testid="preview-filter-invalid"
                >
                  Show invalid
                </Button>
                <Button
                  size="sm"
                  variant={previewFilter === "valid" ? "default" : "outline"}
                  onClick={() => setPreviewFilter("valid")}
                  data-testid="preview-filter-valid"
                >
                  Show valid
                </Button>
              </div>
              {(uploadResp.job.rowsInvalid ?? 0) > 0 && (
                <a
                  href={`${BASE}/api/admin/imports/${uploadResp.job.id}/errors.csv`}
                  className="inline-flex items-center text-sm text-primary hover:underline"
                  data-testid="preview-download-errors"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download error CSV
                </a>
              )}
            </div>

            <div className="border rounded-lg overflow-x-auto max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    {previewFilter === "invalid" && (
                      <TableHead className="w-1/3">Errors</TableHead>
                    )}
                    {uploadResp.columns.map((c) => (
                      <TableHead key={c} className="text-xs whitespace-nowrap">
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={uploadResp.columns.length + 2}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        No {previewFilter} rows.
                      </TableCell>
                    </TableRow>
                  ) : (
                    previewRows.map((r) => (
                      <TableRow
                        key={r.id}
                        data-testid={`preview-row-${r.rowIndex}`}
                      >
                        <TableCell className="text-xs text-muted-foreground">
                          {r.rowIndex + 1}
                        </TableCell>
                        {previewFilter === "invalid" && (
                          <TableCell className="text-xs">
                            {(r.errors ?? []).map((e, i) => (
                              <div key={i} className="text-destructive">
                                <span className="font-mono">{e.field}</span>:{" "}
                                {e.message}
                              </div>
                            ))}
                          </TableCell>
                        )}
                        {uploadResp.columns.map((c) => (
                          <TableCell
                            key={c}
                            className="text-xs whitespace-nowrap"
                          >
                            {r.raw[c] ?? ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep("map")}
                data-testid="preview-back-to-map"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to mapping
              </Button>
              <Button
                onClick={onCommit}
                disabled={busy || (uploadResp.job.rowsValid ?? 0) === 0}
                data-testid="import-commit"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Commit {uploadResp.job.rowsValid ?? 0} valid row
                {uploadResp.job.rowsValid === 1 ? "" : "s"}
              </Button>
            </div>
          </Card>
        )}

        {step === "done" && commitSummary && (
          <Card className="p-6 space-y-6" data-testid="step-done">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-emerald-500/10 p-2">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <div className="text-lg font-semibold">Import complete</div>
                <div className="text-sm text-muted-foreground">
                  {commitSummary.total} row(s) processed.
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat
                label="Created"
                value={commitSummary.imported}
                tone="positive"
                testid="done-imported"
              />
              <Stat
                label="Updated"
                value={commitSummary.updated}
                testid="done-updated"
              />
              <Stat
                label="Skipped (duplicate)"
                value={commitSummary.skippedDuplicate}
                testid="done-skipped"
              />
              <Stat
                label="Invalid"
                value={commitSummary.invalid}
                tone={commitSummary.invalid > 0 ? "negative" : "neutral"}
                testid="done-invalid"
              />
            </div>
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={reset}
                data-testid="done-new-import"
              >
                Import another file
              </Button>
              <Button
                onClick={() => setLocation("/admin")}
                data-testid="done-back-to-admin"
              >
                Back to dashboard
              </Button>
            </div>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "upload", label: "1. Upload" },
    { key: "map", label: "2. Map columns" },
    { key: "preview", label: "3. Preview" },
    { key: "done", label: "4. Done" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2 text-sm" data-testid="step-indicator">
      {steps.map((s, i) => {
        const isCurrent = i === idx;
        const isDone = i < idx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={
                "rounded-full px-3 py-1 border " +
                (isCurrent
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : isDone
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground")
              }
              data-testid={`step-pill-${s.key}`}
              data-active={isCurrent ? "true" : "false"}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span className="text-muted-foreground">→</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Stat({
  label,
  value,
  tone,
  testid,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative" | "neutral";
  testid?: string;
}) {
  const cls =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "negative"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg border p-4" data-testid={testid}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={"text-2xl font-bold " + cls}>{value}</div>
    </div>
  );
}
