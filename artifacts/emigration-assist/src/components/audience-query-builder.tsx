import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";

// Phase 4 — Audience query builder.
//
// Single-level rule list with one top-level combinator (AND / OR). Mirrors
// the server's `AudienceQuery` zod schema in `lib/audienceQuery.ts`. Server
// remains the source of truth — every (field, op) pair the user can produce
// here is a strict subset of what the server accepts.

export type AudienceField =
  | "leadType"
  | "leadStatus"
  | "leadPriority"
  | "source"
  | "inquiryType"
  | "intendedTier"
  | "assignedTo"
  | "createdAt"
  | "lastContactedAt"
  | "nextFollowUpAt"
  | "tags"
  | "hasEmail"
  | "hasWhatsapp";

export type AudienceOp =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gte"
  | "lte"
  | "is_null"
  | "is_not_null"
  | "contains";

export interface AudienceRule {
  field: AudienceField;
  op: AudienceOp;
  value?: string | number | boolean | string[] | null;
}

export interface AudienceQuery {
  combinator: "and" | "or";
  rules: AudienceRule[];
}

const FIELD_LABEL: Record<AudienceField, string> = {
  leadType: "Lead type",
  leadStatus: "Status",
  leadPriority: "Priority",
  source: "Source",
  inquiryType: "Inquiry type",
  intendedTier: "Intended tier",
  assignedTo: "Assigned to (admin id)",
  createdAt: "Created",
  lastContactedAt: "Last contacted",
  nextFollowUpAt: "Next follow-up",
  tags: "Tag",
  hasEmail: "Has email",
  hasWhatsapp: "Has WhatsApp",
};

const FIELD_KIND: Record<
  AudienceField,
  "string" | "ts" | "bool" | "tags" | "uuid" | "enum"
> = {
  leadType: "enum",
  leadStatus: "enum",
  leadPriority: "enum",
  source: "enum",
  inquiryType: "enum",
  intendedTier: "enum",
  assignedTo: "uuid",
  createdAt: "ts",
  lastContactedAt: "ts",
  nextFollowUpAt: "ts",
  tags: "tags",
  hasEmail: "bool",
  hasWhatsapp: "bool",
};

const ENUM_VALUES: Partial<Record<AudienceField, string[]>> = {
  leadType: ["individual", "professional"],
  leadStatus: [
    "new",
    "reviewing",
    "contacted",
    "engaged",
    "qualified",
    "proposal_sent",
    "ready_for_case",
    "converted",
    "closed",
  ],
  leadPriority: ["critical", "high", "medium", "low"],
  source: [
    "web_form",
    "referral",
    "linkedin",
    "facebook",
    "google",
    "direct",
    "csv_import",
    "manual",
    "api",
    "other",
  ],
  inquiryType: ["visa_inquiry", "overstay_appeal", "travel_entry_assistance"],
  intendedTier: [
    "free",
    "basic",
    "plus",
    "pro",
    "premium",
    "starter_firm",
    "growth_firm",
    "scale_firm",
    "enterprise",
    "concierge",
    "unknown",
  ],
};

const OPS_FOR_KIND: Record<string, { value: AudienceOp; label: string }[]> = {
  enum: [
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
    { value: "in", label: "is one of" },
    { value: "not_in", label: "is not one of" },
    { value: "is_null", label: "is empty" },
    { value: "is_not_null", label: "is not empty" },
  ],
  string: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "does not equal" },
    { value: "is_null", label: "is empty" },
    { value: "is_not_null", label: "is not empty" },
  ],
  uuid: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "does not equal" },
    { value: "is_null", label: "is unassigned" },
    { value: "is_not_null", label: "is assigned" },
  ],
  ts: [
    { value: "gte", label: "on or after" },
    { value: "lte", label: "on or before" },
    { value: "is_null", label: "is unset" },
    { value: "is_not_null", label: "is set" },
  ],
  bool: [{ value: "eq", label: "is" }],
  tags: [
    { value: "contains", label: "contains tag" },
    { value: "is_null", label: "has no tags" },
    { value: "is_not_null", label: "has any tag" },
  ],
};

function defaultValueFor(
  field: AudienceField,
  op: AudienceOp,
): AudienceRule["value"] {
  if (op === "is_null" || op === "is_not_null") return undefined;
  if (op === "in" || op === "not_in") return [];
  const kind = FIELD_KIND[field];
  if (kind === "bool") return true;
  if (kind === "ts") return new Date().toISOString();
  if (kind === "enum") return ENUM_VALUES[field]?.[0] ?? "";
  return "";
}

interface Props {
  value: AudienceQuery;
  onChange: (q: AudienceQuery) => void;
}

export function AudienceQueryBuilder({ value, onChange }: Props) {
  const allFields = useMemo(
    () => Object.keys(FIELD_LABEL) as AudienceField[],
    [],
  );

  const update = (next: Partial<AudienceQuery>) =>
    onChange({ ...value, ...next });

  const updateRule = (idx: number, patch: Partial<AudienceRule>) => {
    const rules = value.rules.slice();
    rules[idx] = { ...rules[idx], ...patch };
    update({ rules });
  };

  const removeRule = (idx: number) => {
    const rules = value.rules.slice();
    rules.splice(idx, 1);
    update({ rules });
  };

  const addRule = () => {
    const field: AudienceField = "leadStatus";
    const op: AudienceOp = "eq";
    update({
      rules: [
        ...value.rules,
        { field, op, value: defaultValueFor(field, op) },
      ],
    });
  };

  return (
    <div
      className="space-y-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-4"
      data-testid="audience-query-builder"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-200">Audience rules</div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-400">Match</Label>
          <Select
            value={value.combinator}
            onValueChange={(v) =>
              update({ combinator: v as "and" | "or" })
            }
          >
            <SelectTrigger className="h-8 w-24" data-testid="select-combinator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">ALL of</SelectItem>
              <SelectItem value="or">ANY of</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.rules.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700/60 p-6 text-center text-sm text-slate-400">
          No rules yet. Add at least one rule to define who receives this campaign.
        </div>
      ) : (
        <div className="space-y-2">
          {value.rules.map((rule, idx) => {
            const kind = FIELD_KIND[rule.field];
            const opsForField = OPS_FOR_KIND[kind] ?? OPS_FOR_KIND.string;
            const enumValues = ENUM_VALUES[rule.field];
            const showValueInput = !["is_null", "is_not_null"].includes(rule.op);
            return (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-2 rounded border border-slate-700/40 bg-slate-950/40 p-2"
                data-testid={`rule-row-${idx}`}
              >
                <Select
                  value={rule.field}
                  onValueChange={(v) => {
                    const field = v as AudienceField;
                    const newKind = FIELD_KIND[field];
                    const allowed = OPS_FOR_KIND[newKind] ?? OPS_FOR_KIND.string;
                    const op = allowed.some((o) => o.value === rule.op)
                      ? rule.op
                      : allowed[0].value;
                    updateRule(idx, {
                      field,
                      op,
                      value: defaultValueFor(field, op),
                    });
                  }}
                >
                  <SelectTrigger className="h-9 w-44" data-testid={`select-field-${idx}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allFields.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FIELD_LABEL[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={rule.op}
                  onValueChange={(v) => {
                    const op = v as AudienceOp;
                    updateRule(idx, {
                      op,
                      value: defaultValueFor(rule.field, op),
                    });
                  }}
                >
                  <SelectTrigger className="h-9 w-40" data-testid={`select-op-${idx}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {opsForField.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {showValueInput ? (
                  kind === "bool" ? (
                    <Select
                      value={String(rule.value ?? true)}
                      onValueChange={(v) =>
                        updateRule(idx, { value: v === "true" })
                      }
                    >
                      <SelectTrigger className="h-9 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">yes</SelectItem>
                        <SelectItem value="false">no</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : kind === "enum" && rule.op !== "in" && rule.op !== "not_in" ? (
                    <Select
                      value={String(rule.value ?? enumValues?.[0] ?? "")}
                      onValueChange={(v) => updateRule(idx, { value: v })}
                    >
                      <SelectTrigger className="h-9 w-44" data-testid={`select-value-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(enumValues ?? []).map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : kind === "ts" ? (
                    <Input
                      type="datetime-local"
                      className="h-9 w-56"
                      value={
                        typeof rule.value === "string" && rule.value
                          ? rule.value.slice(0, 16)
                          : ""
                      }
                      onChange={(e) => {
                        const iso = e.target.value
                          ? new Date(e.target.value).toISOString()
                          : "";
                        updateRule(idx, { value: iso });
                      }}
                      data-testid={`input-value-${idx}`}
                    />
                  ) : rule.op === "in" || rule.op === "not_in" ? (
                    <Input
                      className="h-9 min-w-64 flex-1"
                      placeholder="comma-separated values"
                      value={
                        Array.isArray(rule.value) ? rule.value.join(", ") : ""
                      }
                      onChange={(e) =>
                        updateRule(idx, {
                          value: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      data-testid={`input-value-${idx}`}
                    />
                  ) : (
                    <Input
                      className="h-9 min-w-48 flex-1"
                      value={typeof rule.value === "string" ? rule.value : ""}
                      onChange={(e) => updateRule(idx, { value: e.target.value })}
                      data-testid={`input-value-${idx}`}
                    />
                  )
                ) : null}

                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-8 w-8 p-0 text-slate-400 hover:text-rose-300"
                  onClick={() => removeRule(idx)}
                  data-testid={`button-remove-rule-${idx}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={addRule}
        data-testid="button-add-rule"
      >
        <Plus className="mr-2 h-4 w-4" />
        Add rule
      </Button>
    </div>
  );
}
