// Copies client/visit.js into src/beacon-script.js so the Worker can serve it at /visit.js.
// Run after editing client/visit.js: npm run sync-script (a test fails if they differ).
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync(new URL('./client/visit.js', import.meta.url), 'utf8');
writeFileSync(new URL('./src/beacon-script.js', import.meta.url),
  `// Generated from client/visit.js by scripts-sync.mjs - edit that file, then run npm run sync-script.\nexport default ${JSON.stringify(source)};\n`);
console.log('src/beacon-script.js updated');
