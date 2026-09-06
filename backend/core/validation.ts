/**
 * Minimal, dependency-free argument validation for the IPC boundary.
 *
 * Each command declares a positional schema; unknown commands are rejected by
 * the registry before reaching any handler, and arguments are validated here.
 * The layer intentionally cannot express arbitrary code execution, SQL,
 * paths or function names — it only shapes primitives.
 */
import { CoreError, fail } from './errors';

export interface Check<T> {
  readonly label: string;
  check(value: unknown, path: string): T;
}

const asObject = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', `Expected an object for ${path}`);
  }
  return value as Record<string, unknown>;
};

export const v = {
  string: (opts: { min?: number; max?: number; optional?: boolean; allowEmpty?: boolean } = {}): Check<string> => ({
    label: 'string',
    check(value, path) {
      if (value === undefined || value === null) {
        if (opts.optional) return undefined as unknown as string;
        fail('INVALID_ARGUMENT', `Missing required string ${path}`);
      }
      if (typeof value !== 'string') fail('INVALID_ARGUMENT', `Expected a string for ${path}`);
      if (!opts.allowEmpty && value.length === 0) fail('INVALID_ARGUMENT', `${path} must not be empty`);
      if (opts.min !== undefined && value.length < opts.min) fail('INVALID_ARGUMENT', `${path} is too short`);
      if (opts.max !== undefined && value.length > opts.max) fail('INVALID_ARGUMENT', `${path} is too long`);
      return value;
    },
  }),
  optionalString: (): Check<string | undefined> => ({ label: 'string?', check(value, path) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') fail('INVALID_ARGUMENT', `Expected an optional string for ${path}`);
    return value;
  } }),
  boolean: (defaultValue?: boolean): Check<boolean> => ({ label: 'boolean', check(value) {
    if (value === undefined || value === null) return defaultValue ?? false;
    if (typeof value !== 'boolean') fail('INVALID_ARGUMENT', 'Expected a boolean');
    return value;
  } }),
  optionalBoolean: (): Check<boolean | undefined> => ({ label: 'boolean?', check(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'boolean') fail('INVALID_ARGUMENT', 'Expected an optional boolean');
    return value;
  } }),
  number: (opts: { min?: number; max?: number; integer?: boolean; optional?: boolean } = {}): Check<number> => ({
    label: 'number',
    check(value, path) {
      if (value === undefined || value === null) {
        if (opts.optional) return undefined as unknown as number;
        fail('INVALID_ARGUMENT', `Missing number ${path}`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_ARGUMENT', `Expected a number for ${path}`);
      if (opts.integer && !Number.isInteger(value)) fail('INVALID_ARGUMENT', `${path} must be an integer`);
      if (opts.min !== undefined && value < opts.min) fail('INVALID_ARGUMENT', `${path} must be >= ${opts.min}`);
      if (opts.max !== undefined && value > opts.max) fail('INVALID_ARGUMENT', `${path} must be <= ${opts.max}`);
      return value;
    },
  }),
  id: (optional = false): Check<string> => ({ label: 'id', check(value, path) {
    if (value === undefined || value === null) {
      if (optional) return undefined as unknown as string;
      fail('INVALID_ARGUMENT', `Missing id ${path}`);
    }
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_:.-]{0,127}$/.test(value)) {
      fail('INVALID_ARGUMENT', `Invalid identifier for ${path}`);
    }
    return value as string;
  } }),
  object: <T = Record<string, unknown>>(shape?: (obj: Record<string, unknown>, path: string) => T): Check<T> => ({
    label: 'object',
    check(value, path) {
      const obj = asObject(value, path);
      return shape ? shape(obj, path) : (obj as T);
    },
  }),
  optionalObject: <T = Record<string, unknown>>(shape?: (obj: Record<string, unknown>, path: string) => T): Check<T | undefined> => ({
    label: 'object?',
    check(value, path) {
      if (value === undefined || value === null) return undefined;
      const obj = asObject(value, path);
      return shape ? shape(obj, path) : (obj as T);
    },
  }),
  array: <T>(item: Check<T>, opts: { max?: number } = {}): Check<T[]> => ({ label: `${item.label}[]`, check(value, path) {
    if (!Array.isArray(value)) fail('INVALID_ARGUMENT', `Expected an array for ${path}`);
    if (opts.max !== undefined && value.length > opts.max) fail('INVALID_ARGUMENT', `${path} has too many items`);
    return value.map((entry, i) => item.check(entry, `${path}[${i}]`));
  } }),
  unknown: (): Check<unknown> => ({ label: 'unknown', check(value) { return value; } }),
};

/** Validate a positional args array against a schema. */
export function validateArgs(schema: Check<unknown>[], args: unknown[]): unknown[] {
  if (!Array.isArray(args)) fail('INVALID_ARGUMENT', 'Args must be an array');
  if (args.length > schema.length) fail('INVALID_ARGUMENT', `Too many arguments (expected ${schema.length})`);
  return schema.map((check, i) => check.check(args[i], `arg${i + 1}`));
}

/** Narrow a plain object field to a typed record for storage. */
export function asRecord(value: unknown, path: string): Record<string, unknown> {
  return asObject(value, path);
}

export { CoreError };
