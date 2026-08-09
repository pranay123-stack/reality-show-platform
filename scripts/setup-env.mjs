#!/usr/bin/env node
/** Copies .env.example -> .env when .env does not already exist. */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.env');
const template = resolve(root, '.env.example');

if (existsSync(target)) {
  console.log('.env already exists — leaving it untouched.');
  process.exit(0);
}

copyFileSync(template, target);
console.log('.env created from .env.example. Review the values before running the stack.');
