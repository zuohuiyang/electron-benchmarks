#!/usr/bin/env node
import { main } from '../dist/cli.js';
main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
