// JSON-schema subset validator shared by the config, ticket, report and review contracts:
// type, required, properties, additionalProperties, enum, const, pattern, items, minItems,
// minLength, minimum, maximum, oneOf. Returns a list of { path, message }.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { schemasDir } from './paths.mjs';

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const matchesType = (value, type) => {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
};

export function validate(schema, value, path = '$') {
  const errors = [];
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((option) => validate(option, value, path).length === 0);
    if (passing.length !== 1) {
      const hint = schema.description ? ` (${schema.description})` : '';
      errors.push({ path, message: `must match exactly one allowed shape${hint}` });
    }
    return errors;
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((type) => matchesType(value, type))) {
      errors.push({ path, message: `must be ${types.join(' or ')}, got ${typeOf(value)}` });
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) errors.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.includes(value)) errors.push({ path, message: `must be one of ${schema.enum.join(', ')}` });
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `must match ${schema.pattern}` });
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: schema.minLength === 1 ? 'must not be empty' : `needs at least ${schema.minLength} characters` });
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `must be ≥ ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `must be ≤ ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `needs at least ${schema.minItems} item(s)` });
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push({ path: `${path}.${key}`, message: 'is required' });
    }
    const allowed = Object.keys(schema.properties ?? {});
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], item, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push({ path: `${path}.${key}`, message: `is not allowed (allowed: ${allowed.join(', ')})` });
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, item, `${path}.${key}`));
    }
  }
  return errors;
}

const loaded = new Map();
export function loadSchema(name) {
  if (!loaded.has(name)) loaded.set(name, JSON.parse(readFileSync(join(schemasDir, `${name}.schema.json`), 'utf8')));
  return loaded.get(name);
}

export const validateWith = (name, value) => validate(loadSchema(name), value);

export const formatErrors = (errors) => errors.map((error) => `${error.path}: ${error.message}`).join('\n');
