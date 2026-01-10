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

const GENERATED_DIR = path.join(import.meta.dir, '../generated');
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

  // Build replacement map from schema assignments
  for (const assignment of schemaAssignments) {
    bodyTypeReplacements.set(assignment.inputTypeName, assignment.outputTypeName);
  }

  // Find query type imports: t_XQuerySchema (these don't have schema assignments)
  const queryTypeRegex = /t_(\w+)QuerySchema/g;
  let match;
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
    '/* eslint-disable */',
    '',
    "import { z } from 'zod/v3';",
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
      lines.push(`export const ${schema.variableName} = ${schema.schemaCode};`);
      lines.push(`export type ${schema.outputTypeName} = z.output<typeof ${schema.variableName}>;`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Post-process a route file to use output types
 */
function postProcessRouteFile(routeFile: RouteFileInfo): void {
  let content = fs.readFileSync(routeFile.filePath, 'utf-8');

  // Collect all output types we need to import
  const outputTypesToImport: string[] = [];

  // Replace body types in Params<P, Q, B, H> generics
  for (const [inputType, outputType] of routeFile.bodyTypeReplacements) {
    // Find the pattern: Params<..., ..., t_XRequestBodySchema, ...>
    // and replace with: Params<..., ..., XRequestOutput, ...>
    const paramsRegex = new RegExp(`(Params<[^>]*,\\s*[^,]*,\\s*)${inputType}(\\s*,)`, 'g');
    if (paramsRegex.test(content)) {
      content = content.replace(paramsRegex, `$1${outputType}$2`);
      outputTypesToImport.push(outputType);
    }
  }

  // Replace query types in Params<P, Q, B, H> generics
  for (const [inputType, outputType] of routeFile.queryTypeReplacements) {
    // Find the pattern: Params<..., t_XQuerySchema, ..., ...>
    const paramsRegex = new RegExp(`(Params<[^,]*,\\s*)${inputType}(\\s*,)`, 'g');
    if (paramsRegex.test(content)) {
      content = content.replace(paramsRegex, `$1${outputType}$2`);
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

    const paramsRegex = new RegExp(`(Params<[^,]*,\\s*)${inputTypeName}(\\s*,)`, 'g');
    if (paramsRegex.test(content)) {
      content = content.replace(paramsRegex, `$1${outputType}$2`);
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
  }

  fs.writeFileSync(routeFile.filePath, content);
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
    .map((f) => analyzeRouteFile(path.join(ROUTES_DIR, f)));

  const totalInlineSchemas = routeFiles.reduce((sum, rf) => sum + rf.inlineQuerySchemas.length, 0);
  console.log(`   Found ${totalInlineSchemas} inline query schemas in route files`);

  // Phase 3: Generate outputTypes.ts
  const outputTypesContent = generateOutputTypesFile(schemas, routeFiles);
  fs.writeFileSync(OUTPUT_TYPES_FILE, outputTypesContent);
  console.log(`   Generated ${OUTPUT_TYPES_FILE}`);

  // Phase 4: Post-process route files
  for (const routeFile of routeFiles) {
    const hasReplacements =
      routeFile.bodyTypeReplacements.size > 0 ||
      routeFile.queryTypeReplacements.size > 0 ||
      routeFile.inlineQuerySchemas.length > 0;

    if (hasReplacements) {
      postProcessRouteFile(routeFile);
      console.log(`   Post-processed ${path.basename(routeFile.filePath)}`);
    }
  }

  console.log('✅ Output types generation complete!');
}

main();
