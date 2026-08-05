/**
 * Post-processing script for OpenAPI code generation
 *
 * This script runs after @nahkies/openapi-code-generator to:
 * 1. Generate output types from Zod schemas (with defaults applied)
 * 2. Modify route files to use output types instead of input types
 *
 * This fixes the issue where generated TypeScript types represent input types
 * (what the schema accepts) rather than output types (what you get after Zod parsing).
 */

import * as fs from 'fs';
import * as path from 'path';

// Overridable so the test suite can point the script at a fixture tree instead
// of the real generated output.
const GENERATED_DIR = process.env.OUTPUT_TYPES_GENERATED_DIR ?? path.join(import.meta.dirname, '../generated');
const SCHEMAS_FILE = path.join(GENERATED_DIR, 'schemas.ts');
const OUTPUT_TYPES_FILE = path.join(GENERATED_DIR, 'outputTypes.ts');
const ROUTES_DIR = path.join(GENERATED_DIR, 'routes');

interface SchemaInfo {
  name: string; // e.g., "s_SearchRequest"
  outputTypeName: string; // e.g., "SearchRequestOutput"
}

interface InlineQuerySchema {
  variableName: string; // e.g., "fetchMediaInfoQuerySchema"
  schemaCode: string; // The full z.object({...}) code
  outputTypeName: string; // e.g., "FetchMediaInfoQueryOutput"
}

interface SchemaAssignment {
  variableName: string; // e.g., "loginDiscordRequestBodySchema"
  schemaName: string; // e.g., "s_DiscordLoginRequest"
  inputTypeName: string; // e.g., "t_LoginDiscordRequestBodySchema"
  outputTypeName: string; // e.g., "DiscordLoginRequestOutput"
}

interface RouteFileInfo {
  filePath: string;
  inlineQuerySchemas: InlineQuerySchema[];
  schemaAssignments: SchemaAssignment[];
  bodyTypeReplacements: Map<string, string>; // t_XRequestBodySchema -> XRequestOutput
  queryTypeReplacements: Map<string, string>; // t_XQuerySchema -> XQueryOutput
}

/**
 * Extract all schema names from schemas.ts
 */
function extractSchemaNames(): SchemaInfo[] {
  const content = fs.readFileSync(SCHEMAS_FILE, 'utf-8');
  const schemaRegex = /^export const (s_\w+)\s*=/gm;
  const schemas: SchemaInfo[] = [];

  let match;
  while ((match = schemaRegex.exec(content)) !== null) {
    const name = match[1];
    if (!name) continue;
    // Convert s_SearchRequest -> SearchRequestOutput
    const baseName = name.replace(/^s_/, '');
    schemas.push({
      name,
      outputTypeName: `${baseName}Output`,
    });
  }

  return schemas;
}

/**
 * Extract inline query schemas from a route file
 */
function extractInlineQuerySchemas(content: string): InlineQuerySchema[] {
  const schemas: InlineQuerySchema[] = [];

  // Match patterns like: const fetchMediaInfoQuerySchema = z.object({...});
  // We need to handle nested braces properly
  const schemaStartRegex = /const\s+(\w+QuerySchema)\s*=\s*(z\.object\(\{)/g;

  let match;
  while ((match = schemaStartRegex.exec(content)) !== null) {
    const variableName = match[1];
    if (!variableName) continue;
    const startIndex = match.index + match[0].length - 'z.object({'.length;

    // Find the matching closing brace by counting braces
    let braceCount = 0;
    let endIndex = startIndex;
    let inString = false;
    let stringChar = '';

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      const prevChar = i > 0 ? content[i - 1] : '';

      // Handle string literals
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (inString) continue;

      if (char === '(' || char === '{') {
        braceCount++;
      } else if (char === ')' || char === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    const schemaCode = content.slice(startIndex, endIndex);

    // Convert fetchMediaInfoQuerySchema -> FetchMediaInfoQueryOutput
    const baseName = variableName.replace(/QuerySchema$/, '');
    const pascalCaseName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

    schemas.push({
      variableName,
      schemaCode,
      outputTypeName: `${pascalCaseName}QueryOutput`,
    });
  }

  return schemas;
}

/**
 * Extract schema assignments from a route file
 * Matches patterns like: const loginDiscordRequestBodySchema = s_DiscordLoginRequest;
 */
function extractSchemaAssignments(content: string): SchemaAssignment[] {
  const assignments: SchemaAssignment[] = [];

  // Match body schema assignments: const xRequestBodySchema = s_YRequest;
  const bodySchemaRegex = /const\s+(\w+RequestBodySchema)\s*=\s*(s_\w+)/g;
  let match;
  while ((match = bodySchemaRegex.exec(content)) !== null) {
    const variableName = match[1]; // e.g., "loginDiscordRequestBodySchema"
    const schemaName = match[2]; // e.g., "s_DiscordLoginRequest"
    if (!variableName || !schemaName) continue;

    // Derive input type name from variable name
    // loginDiscordRequestBodySchema -> t_LoginDiscordRequestBodySchema
    const pascalVariableName = variableName.charAt(0).toUpperCase() + variableName.slice(1);
    const inputTypeName = `t_${pascalVariableName}`;

    // Derive output type name from schema name
    // s_DiscordLoginRequest -> DiscordLoginRequestOutput
    const baseName = schemaName.replace(/^s_/, '');
    const outputTypeName = `${baseName}Output`;

    assignments.push({
      variableName,
      schemaName,
      inputTypeName,
      outputTypeName,
    });
  }

  return assignments;
}

/**
 * Analyze a route file to understand what types need to be replaced
 */
function analyzeRouteFile(filePath: string): RouteFileInfo {
  const content = fs.readFileSync(filePath, 'utf-8');
  const inlineQuerySchemas = extractInlineQuerySchemas(content);
  const schemaAssignments = extractSchemaAssignments(content);

  const bodyTypeReplacements = new Map<string, string>();
  const queryTypeReplacements = new Map<string, string>();

  // Build replacement map from legacy schema assignments (generator <= 0.22).
  for (const assignment of schemaAssignments) {
    bodyTypeReplacements.set(assignment.inputTypeName, assignment.outputTypeName);
  }

  // Generator >= 0.23 inlines named schemas directly in parseRequestInput
  // and uses the model input type in Params (for example t_SearchRequest).
  // Map those input types back to z.output types, where defaults are applied.
  const parsedBodySchemaRegex = /body:\s*parseRequestInput\(\s*s_(\w+)\s*,/g;
  let match;
  while ((match = parsedBodySchemaRegex.exec(content)) !== null) {
    const baseName = match[1];
    bodyTypeReplacements.set(`t_${baseName}`, `${baseName}Output`);
  }

  const parsedQuerySchemaRegex = /query:\s*parseRequestInput\(\s*s_(\w+)\s*,/g;
  while ((match = parsedQuerySchemaRegex.exec(content)) !== null) {
    const baseName = match[1];
    queryTypeReplacements.set(`t_${baseName}`, `${baseName}Output`);
  }

  // Find legacy inline query type imports: t_XQuerySchema.
  const queryTypeRegex = /t_(\w+)QuerySchema/g;
  while ((match = queryTypeRegex.exec(content)) !== null) {
    const baseName = match[1];
    // t_FetchMediaInfoQuerySchema -> FetchMediaInfoQueryOutput
    queryTypeReplacements.set(match[0], `${baseName}QueryOutput`);
  }

  return {
    filePath,
    inlineQuerySchemas,
    schemaAssignments,
    bodyTypeReplacements,
    queryTypeReplacements,
  };
}

/**
 * Generate the outputTypes.ts file
 */
function generateOutputTypesFile(schemas: SchemaInfo[], routeFiles: RouteFileInfo[]): string {
  const lines: string[] = [
    '/** AUTOGENERATED BY scripts/generateOutputTypes.ts - DO NOT EDIT **/',
    '/* tslint:disable */',
    '',
    "import { z } from 'zod/v4';",
    "import * as schemas from './schemas';",
    '',
    '// ============================================',
    '// Output types for named schemas (post-parsing, defaults applied)',
    '// ============================================',
  ];

  // Add output types for all schemas
  for (const schema of schemas) {
    lines.push(`export type ${schema.outputTypeName} = z.output<typeof schemas.${schema.name}>;`);
  }

  // Collect all inline query schemas from all route files
  const allInlineSchemas: InlineQuerySchema[] = [];
  for (const routeFile of routeFiles) {
    allInlineSchemas.push(...routeFile.inlineQuerySchemas);
  }

  if (allInlineSchemas.length > 0) {
    lines.push('');
    lines.push('// ============================================');
    lines.push('// Inline query schemas and their output types');
    lines.push('// ============================================');

    for (const schema of allInlineSchemas) {
      lines.push('');
      // Prefix schema references with schemas. since outputTypes.ts imports them as a namespace
      const prefixedCode = schema.schemaCode
        .replace(/\b(s_\w+)\b/g, 'schemas.$1')
        .replace(/\bPermissiveBoolean\b/g, 'schemas.PermissiveBoolean');
      lines.push(`export const ${schema.variableName} = ${prefixedCode};`);
      lines.push(`export type ${schema.outputTypeName} = z.output<typeof ${schema.variableName}>;`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Apply a global replacement, reporting how many times it fired.
 *
 * Every rewrite below is anchored on the *position* of a type inside a
 * `Params<P, Q, B, H>` generic, so a change to the generator's whitespace or
 * generic arity makes the pattern stop matching. Counting is what lets the
 * caller tell "nothing to do" apart from "the pattern went stale".
 */
function replaceCounted(content: string, pattern: RegExp, replacement: string): { content: string; count: number } {
  const matches = content.match(pattern);
  if (!matches) return { content, count: 0 };
  return { content: content.replace(pattern, replacement), count: matches.length };
}

/**
 * Find input types that survived the rewrite inside a `Params<>` generic.
 *
 * A name only reaches `inputTypeNames` because the route parses that slot with
 * a Zod schema, so it must not appear in any slot of the emitted generic --
 * path and header slots use their own `t_XParamSchema` / `t_XHeaderSchema`
 * names, which are never replacement keys. Checking every slot rather than
 * just the query and body positions means a change in generic arity is caught
 * too, instead of quietly moving the body type somewhere we do not look.
 */
function findUnreplacedInputTypes(content: string, inputTypeNames: Set<string>): string[] {
  const stale = new Set<string>();

  for (const match of content.matchAll(/Params<([^>]*)>/g)) {
    for (const slot of (match[1] ?? '').split(',')) {
      const name = slot.trim();
      if (inputTypeNames.has(name)) stale.add(name);
    }
  }

  return [...stale].sort();
}

/**
 * Post-process a route file to use output types
 *
 * Returns the number of type replacements applied. Throws if the rewrite did
 * not land: a silent no-op leaves the backend compiling against Zod *input*
 * types, so applied defaults disappear from the types while everything still
 * typechecks.
 */
function postProcessRouteFile(routeFile: RouteFileInfo): number {
  const fileName = path.basename(routeFile.filePath);
  let content = fs.readFileSync(routeFile.filePath, 'utf-8');

  // Collect all output types we need to import
  const outputTypesToImport: string[] = [];
  // Every input type we expect to be gone from the generics by the end.
  const inputTypeNames = new Set<string>();
  let replacements = 0;

  // Replace body types in Params<P, Q, B, H> generics
  for (const [inputType, outputType] of routeFile.bodyTypeReplacements) {
    inputTypeNames.add(inputType);
    // Find the pattern: Params<..., ..., t_XRequestBodySchema, ...>
    // and replace with: Params<..., ..., XRequestOutput, ...>
    const paramsRegex = new RegExp(`(Params<[^>]*,\\s*[^,]*,\\s*)${inputType}(\\s*,)`, 'g');
    const result = replaceCounted(content, paramsRegex, `$1${outputType}$2`);
    if (result.count > 0) {
      content = result.content;
      replacements += result.count;
      outputTypesToImport.push(outputType);
    }
  }

  // Replace query types in Params<P, Q, B, H> generics
  for (const [inputType, outputType] of routeFile.queryTypeReplacements) {
    inputTypeNames.add(inputType);
    // Find the pattern: Params<..., t_XQuerySchema, ..., ...>
    const paramsRegex = new RegExp(`(Params<[^,]*,\\s*)${inputType}(\\s*,)`, 'g');
    const result = replaceCounted(content, paramsRegex, `$1${outputType}$2`);
    if (result.count > 0) {
      content = result.content;
      replacements += result.count;
      outputTypesToImport.push(outputType);
    }
  }

  // Handle inline query schemas - replace their usage in Params
  for (const inlineSchema of routeFile.inlineQuerySchemas) {
    // The inline schema's output type name based on the variable name
    // fetchMediaInfoQuerySchema -> FetchMediaInfoQueryOutput
    const outputType = inlineSchema.outputTypeName;

    // Find t_FetchMediaInfoQuerySchema in Params and replace with output type
    const baseName = inlineSchema.variableName.replace(/QuerySchema$/, '');
    const pascalCaseName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
    const inputTypeName = `t_${pascalCaseName}QuerySchema`;
    inputTypeNames.add(inputTypeName);

    const paramsRegex = new RegExp(`(Params<[^,]*,\\s*)${inputTypeName}(\\s*,)`, 'g');
    const result = replaceCounted(content, paramsRegex, `$1${outputType}$2`);
    if (result.count > 0) {
      content = result.content;
      replacements += result.count;
      outputTypesToImport.push(outputType);
    }
  }

  // Add import statement for output types if we have any replacements
  if (outputTypesToImport.length > 0) {
    const uniqueTypes = [...new Set(outputTypesToImport)].sort();
    const importStatement = `import type { ${uniqueTypes.join(', ')} } from '../outputTypes.ts';`;

    // Find a good place to insert the import - after existing imports from '../models.ts'
    const modelsImportRegex = /(import type \{[^}]+\} from ['"]\.\.\/models\.ts['"];?\n)/;
    const modelsMatch = content.match(modelsImportRegex);

    if (modelsMatch) {
      content = content.replace(modelsImportRegex, `$1${importStatement}\n`);
    } else {
      // Fallback: insert after the last import statement
      const lastImportRegex = /(import [^;]+;?\n)(?!import)/;
      content = content.replace(lastImportRegex, `$1${importStatement}\n`);
    }

    if (!content.includes(importStatement)) {
      throw new Error(
        `${fileName}: rewrote ${replacements} type(s) but could not insert the outputTypes import; ` +
          'neither the models import nor the trailing-import fallback matched the generated file.',
      );
    }
  }

  const stale = findUnreplacedInputTypes(content, inputTypeNames);
  if (stale.length > 0) {
    throw new Error(
      `${fileName}: input type(s) still present in a Params<> generic after post-processing: ${stale.join(', ')}. ` +
        'The route would compile against Zod input types, dropping applied defaults from the types.',
    );
  }

  // Written only once every assertion has passed, so a failure leaves the
  // generator's own output in place rather than a half-rewritten file.
  fs.writeFileSync(routeFile.filePath, content);

  return replacements;
}

/**
 * Main function
 */
function main() {
  console.log('🔄 Generating output types...');

  // Phase 1: Extract schema information
  const schemas = extractSchemaNames();
  console.log(`   Found ${schemas.length} schemas in schemas.ts`);

  // Phase 2: Analyze route files
  const routeFiles = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => analyzeRouteFile(path.join(ROUTES_DIR, f)));

  const totalInlineSchemas = routeFiles.reduce((sum, rf) => sum + rf.inlineQuerySchemas.length, 0);
  console.log(`   Found ${totalInlineSchemas} inline query schemas in route files`);

  // Phase 3: Generate outputTypes.ts
  const outputTypesContent = generateOutputTypesFile(schemas, routeFiles);
  fs.writeFileSync(OUTPUT_TYPES_FILE, outputTypesContent);
  console.log(`   Generated ${OUTPUT_TYPES_FILE}`);

  // Phase 4: Post-process route files
  let totalReplacements = 0;
  let expectedReplacements = 0;

  for (const routeFile of routeFiles) {
    const hasReplacements =
      routeFile.bodyTypeReplacements.size > 0 ||
      routeFile.queryTypeReplacements.size > 0 ||
      routeFile.inlineQuerySchemas.length > 0;

    if (hasReplacements) {
      expectedReplacements++;
      const replaced = postProcessRouteFile(routeFile);
      totalReplacements += replaced;
      console.log(`   Post-processed ${path.basename(routeFile.filePath)} (${replaced} replacements)`);
    }
  }

  // Per-file assertions catch a pattern that half-matched. This catches the
  // case where none of them can match at all -- a renamed wrapper, or a
  // generic reshaped past what the position-anchored patterns understand --
  // which would otherwise report a clean run having rewritten nothing.
  if (expectedReplacements > 0 && totalReplacements === 0) {
    throw new Error(
      `${expectedReplacements} route file(s) parse a request with Zod but no Params<> generic was rewritten. ` +
        'The generator output no longer matches the expected shape; check @nahkies/openapi-code-generator.',
    );
  }

  console.log(`✅ Output types generation complete! (${totalReplacements} replacements)`);
}

try {
  main();
} catch (error) {
  console.error(`❌ Output types generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
