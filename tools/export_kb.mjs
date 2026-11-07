// Dump the knowledge base to data/kb.json so a fresh deployment seeds it on first start.
import fs from 'node:fs';
import path from 'node:path';
import { q, DATA_DIR } from '../server/db.js';
const rows = q.all('SELECT chapter_id c, slide_no s, text t FROM kb_chunks ORDER BY chapter_id, slide_no');
fs.writeFileSync(path.join(DATA_DIR, 'kb.json'), JSON.stringify(rows));
console.log(`exported ${rows.length} chunks -> data/kb.json`);
