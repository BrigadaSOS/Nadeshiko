#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import yaml from 'yaml';

/**
 * Removes x-internal properties from tags and operations in docs/generated/openapi-internal.yaml
 * This allows Scalar to display all endpoints including internal ones.
 */
const FILE = './docs/generated/openapi-internal.yaml';

const content = readFileSync(FILE, 'utf-8');
const spec: any = yaml.parse(content);

// Remove x-internal from tags
if (spec.tags) {
  for (const tag of spec.tags) {
    delete tag['x-internal'];
  }
}

// Remove x-internal from operations (endpoints)
if (spec.paths) {
  for (const pathItem of Object.values(spec.paths)) {
    if (pathItem && typeof pathItem === 'object') {
      for (const operation of Object.values(pathItem)) {
        if (operation && typeof operation === 'object') {
          delete operation['x-internal'];
        }
      }
    }
  }
}

writeFileSync(FILE, yaml.stringify(spec), 'utf-8');
