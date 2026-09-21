export type DecodedFieldOptions =
  | { valid: true; values: string[] | undefined }
  | { valid: false };

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const sameValues = (left: string[], right: string[]) =>
  left.length === right.length &&
  [...left].sort().every((value, index) => value === [...right].sort()[index]);

/** Decodes both documented legacy and actual GHL v3 option response shapes. */
export function decodeRemoteFieldOptions(field: unknown): DecodedFieldOptions {
  if (!field || typeof field !== "object") return { valid: false };
  const value = field as Record<string, unknown>;
  const hasOptions = own(value, "options");
  const hasPicklistOptions = own(value, "picklistOptions");
  if (!hasOptions && !hasPicklistOptions) return { valid: true, values: undefined };
  const options = value.options;
  const picklistOptions = value.picklistOptions;
  if ((hasOptions && (!Array.isArray(options) || !options.every(item => typeof item === "string"))) ||
    (hasPicklistOptions && (!Array.isArray(picklistOptions) || !picklistOptions.every(item => typeof item === "string"))))
    return { valid: false };
  const legacy = options as string[] | undefined;
  const actual = picklistOptions as string[] | undefined;
  if (legacy && actual && !sameValues(legacy, actual)) return { valid: false };
  const values = actual ?? legacy;
  if (values && new Set(values).size !== values.length) return { valid: false };
  return { valid: true, values };
}

export function remoteFieldOptionsMatch(field: unknown, expected?: string[]) {
  const decoded = decodeRemoteFieldOptions(field);
  return decoded.valid && sameValues(decoded.values ?? [], expected ?? []);
}