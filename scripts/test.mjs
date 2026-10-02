import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const scripts = new URL('./', import.meta.url);
const files = (await readdir(scripts)).filter(name => name.endsWith('.test.mjs')).sort().map(name => new URL(name, scripts));
const { fileURLToPath } = await import('node:url');
const run = spawn(process.execPath, ['--test', ...files.map(fileURLToPath)], { stdio: 'inherit' });
run.on('exit', code => { process.exitCode = code ?? 1; });
run.on('error', error => { console.error(error.message); process.exitCode = 1; });
