/**
 * Build-time validation: ensures @Internal() entity fields don't leak into OpenAPI response schemas.
 *
 * 1. Parses entity files for @ResponseSchemas(...) and @Internal() annotations
 * 2. Parses generated/models.ts to extract properties per t_* type (resolving & intersections)
 * 3. Verifies no @Internal() field appears in any declared response type
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MODELS_DIR = join(import.meta.dir, '../app/models');
const GENERATED_MODELS = join(import.meta.dir, '../generated/models.ts');

interface EntityInfo {
  className: string;
  file: string;
  responseSchemas: string[];
  internalFields: string[];
}

function parseEntities(): EntityInfo[] {
  const entities: EntityInfo[] = [];
  const files = readdirSync(MODELS_DIR).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    const content = readFileSync(join(MODELS_DIR, file), 'utf-8');

    const schemaMatch = content.match(/@ResponseSchemas\(([^)]+)\)/);
    if (!schemaMatch) continue;

    const schemaNames = schemaMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''));

    const classMatch = content.match(/export class (\w+)/);
    if (!classMatch) continue;

    const internalFields: string[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('@Internal()')) {
        // Look ahead for the field declaration
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const fieldMatch = lines[j].match(/^\s+(\w+)[!?]?\s*[:\s]/);
          if (fieldMatch) {
            internalFields.push(fieldMatch[1]);
            break;
          }
        }
      }
    }

    entities.push({
      className: classMatch[1],
      file,
      responseSchemas: schemaNames,
      internalFields,
    });
  }

  return entities;
}

function parseGeneratedModels(): Map<string, Set<string>> {
  const content = readFileSync(GENERATED_MODELS, 'utf-8');
  const typeMap = new Map<string, Set<string>>();
  const refs = new Map<string, string[]>();

  // Split into lines and parse type declarations
  const lines = content.split('\n');
  let currentType = '';
  let braceDepth = 0;
  let currentProps = new Set<string>();
  let currentRefs: string[] = [];

  for (const line of lines) {
    const typeStart = line.match(/^export type (t_(\w+))\s*=\s*(.*)/);
    if (typeStart) {
      currentType = typeStart[2];
      currentProps = new Set<string>();
      currentRefs = [];
      const rest = typeStart[3];

      // Check for intersection refs: t_Foo & ...
      const refMatches = rest.matchAll(/t_(\w+)\s*&/g);
      for (const m of refMatches) {
        currentRefs.push(m[1]);
      }

      // Count braces to track multi-line types
      braceDepth = (rest.match(/\{/g) || []).length - (rest.match(/\}/g) || []).length;

      // Extract props from this line
      const propMatches = rest.matchAll(/(\w+)\s*\??\s*:/g);
      for (const m of propMatches) {
        currentProps.add(m[1]);
      }

      if (braceDepth <= 0 && rest.includes(';')) {
        typeMap.set(currentType, currentProps);
        refs.set(currentType, currentRefs);
        currentType = '';
      }
      continue;
    }

    if (currentType) {
      braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

      // Only extract top-level properties (depth 1)
      if (braceDepth === 1) {
        const propMatch = line.match(/^\s+(\w+)\s*\??\s*:/);
        if (propMatch) {
          currentProps.add(propMatch[1]);
        }
      }

      if (line.includes(';') && braceDepth <= 0) {
        typeMap.set(currentType, currentProps);
        refs.set(currentType, currentRefs);
        currentType = '';
      }
    }
  }

  // Resolve intersection references
  for (const [typeName, props] of typeMap) {
    const typeRefs = refs.get(typeName) || [];
    for (const refName of typeRefs) {
      const refProps = typeMap.get(refName);
      if (refProps) {
        for (const p of refProps) {
          props.add(p);
        }
      }
    }
  }

  return typeMap;
}

function validate(): boolean {
  const entities = parseEntities();
  const typeMap = parseGeneratedModels();
  const violations: string[] = [];

  for (const entity of entities) {
    for (const schemaName of entity.responseSchemas) {
      const schemaProps = typeMap.get(schemaName);
      if (!schemaProps) continue;

      for (const field of entity.internalFields) {
        if (schemaProps.has(field)) {
          violations.push(
            `${entity.className}.${field} is @Internal() but appears in schema '${schemaName}' (t_${schemaName})`,
          );
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('\n❌ Internal field validation failed:\n');
    for (const v of violations) {
      console.error(`  • ${v}`);
    }
    console.error(
      '\nThese fields are marked @Internal() on the entity but exist in the OpenAPI response schema.',
    );
    console.error('Remove them from the schema or remove the @Internal() decorator.\n');
    return false;
  }

  console.log('✅ Internal field validation passed');
  return true;
}

if (!validate()) {
  process.exit(1);
}
