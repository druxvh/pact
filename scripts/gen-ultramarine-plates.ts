// Writes src/styles/ultramarine-plates.css from src/features/ultramarine/plates.ts. Run: bun scripts/gen-ultramarine-plates.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ultramarinePlatesCss } from '../src/features/ultramarine/plates';

const out = resolve(import.meta.dir, '../src/styles/ultramarine-plates.css');
writeFileSync(out, ultramarinePlatesCss());
console.log(`wrote ${out}`);
