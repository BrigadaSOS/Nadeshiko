/**
 * Decorators for enforcing that internal entity fields don't leak into API response schemas.
 * These are no-ops at runtime — enforcement happens via bin/validateInternalFields.ts at build time.
 */

/**
 * Class decorator: declares which OpenAPI response schemas this entity maps to.
 * Used by the validation script to check that @Internal() fields don't appear in those schemas.
 */
export function ResponseSchemas(..._schemaNames: string[]): ClassDecorator {
  return () => {};
}

/**
 * Property decorator: marks a field as internal (not exposed in any response schema).
 * The validation script ensures these fields don't appear in the schemas listed by @ResponseSchemas().
 */
export function Internal(): PropertyDecorator {
  return () => {};
}
