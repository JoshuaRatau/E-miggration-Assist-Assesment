import Papa from "papaparse";
import * as XLSX from "xlsx";

// Hard cap on rows per import. The wizard is sized for "an operator pasting
// in a one-off list of leads", not bulk migration. 5 000 keeps the inline
// commit-loop comfortably under the request-timeout budget and bounds the
// per-job memory cost at parse time. If we ever need more we'll move to a
// background-queue worker (out of Phase B scope).
export const MAX_ROWS = 5000;

export interface ParseResult {
  columns: string[];
  rows: Array<Record<string, string>>;
}

export interface ParseError {
  code:
    | "EMPTY_FILE"
    | "TOO_MANY_ROWS"
    | "PARSE_FAILED"
    | "UNSUPPORTED_FORMAT"
    | "NO_HEADER";
  message: string;
}

const CSV_MIMES = new Set([
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.ms-excel", // some browsers stamp .csv with this
]);

const XLSX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

function uniquifyColumns(raw: string[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const r of raw) {
    const base = r.length === 0 ? "column" : r;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push(n === 0 ? base : `${base}_${n + 1}`);
  }
  return out;
}

export function parseCsv(buffer: Buffer): ParseResult | ParseError {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, ""); // strip BOM
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  // PapaParse emits `errors` for several non-fatal conditions (e.g. row has
  // fewer fields than the header). We only treat structural delimiter / quote
  // failures as fatal — the rest are surfaced per-row at validation time.
  const fatal = result.errors.find(
    (e) => e.type === "Delimiter" || e.type === "Quotes",
  );
  if (fatal) return { code: "PARSE_FAILED", message: fatal.message };
  const columnsRaw = (result.meta.fields ?? []).map((c) => c ?? "");
  if (columnsRaw.length === 0) {
    return { code: "NO_HEADER", message: "CSV has no header row" };
  }
  const columns = uniquifyColumns(columnsRaw);
  const rows: Array<Record<string, string>> = [];
  for (const r of result.data) {
    const out: Record<string, string> = {};
    let nonEmpty = false;
    for (let i = 0; i < columns.length; i++) {
      const v = String(r[columnsRaw[i]!] ?? "").trim();
      out[columns[i]!] = v;
      if (v.length > 0) nonEmpty = true;
    }
    if (nonEmpty) rows.push(out);
  }
  return { columns, rows };
}

export function parseXlsx(buffer: Buffer): ParseResult | ParseError {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    return { code: "PARSE_FAILED", message: (err as Error).message };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { code: "EMPTY_FILE", message: "Workbook has no sheets" };
  }
  const sheet = wb.Sheets[sheetName]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (aoa.length === 0) {
    return { code: "EMPTY_FILE", message: "Sheet is empty" };
  }
  const headerRow = aoa[0] as unknown[];
  const columnsRaw = headerRow.map((c) => String(c ?? "").trim());
  // Trim trailing-empty header cells (Excel pads short header rows).
  while (columnsRaw.length > 0 && columnsRaw[columnsRaw.length - 1] === "") {
    columnsRaw.pop();
  }
  if (columnsRaw.length === 0) {
    return { code: "NO_HEADER", message: "Sheet has no header row" };
  }
  const columns = uniquifyColumns(columnsRaw);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] as unknown[];
    let nonEmpty = false;
    const out: Record<string, string> = {};
    for (let j = 0; j < columns.length; j++) {
      const v = String(r[j] ?? "").trim();
      out[columns[j]!] = v;
      if (v.length > 0) nonEmpty = true;
    }
    if (nonEmpty) rows.push(out);
  }
  return { columns, rows };
}

export function parseFile(args: {
  buffer: Buffer;
  mime: string;
  filename: string;
}): ParseResult | ParseError {
  const { buffer, mime, filename } = args;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  let result: ParseResult | ParseError;
  // Prefer the file extension when it disagrees with the mime — browsers
  // are notoriously inconsistent about which CSV mime they stamp.
  if (ext === "csv") {
    result = parseCsv(buffer);
  } else if (ext === "xlsx" || ext === "xls") {
    result = parseXlsx(buffer);
  } else if (CSV_MIMES.has(mime)) {
    result = parseCsv(buffer);
  } else if (XLSX_MIMES.has(mime)) {
    result = parseXlsx(buffer);
  } else {
    return {
      code: "UNSUPPORTED_FORMAT",
      message: `Unsupported file: mime=${mime}, ext=.${ext}`,
    };
  }
  if ("code" in result) return result;
  if (result.rows.length === 0) {
    return { code: "EMPTY_FILE", message: "No data rows after the header" };
  }
  if (result.rows.length > MAX_ROWS) {
    return {
      code: "TOO_MANY_ROWS",
      message: `Row count ${result.rows.length} exceeds cap of ${MAX_ROWS}`,
    };
  }
  return result;
}
