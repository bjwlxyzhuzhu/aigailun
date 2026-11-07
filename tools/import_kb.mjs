// Import a lecture PPTX into the AI knowledge base (kb_chunks), one chunk per slide.
// Usage: node --no-warnings tools/import_kb.mjs <chapter 1-11> <file.pptx>
import fs from 'node:fs';
import { q, tx } from '../server/db.js';
import { pptxSlides } from '../server/lib.js';

const [ch, file] = [+process.argv[2], process.argv[3]];
if (!(ch >= 1 && ch <= 11) || !file) { console.error('用法: node tools/import_kb.mjs <章节号1-11> <文件.pptx>'); process.exit(1); }
const slides = pptxSlides(fs.readFileSync(file));
tx(() => {
  q.run("DELETE FROM kb_chunks WHERE chapter_id=? AND src='slide'", ch);
  slides.forEach((t, i) => { if (t.length > 8) q.run('INSERT INTO kb_chunks(chapter_id,slide_no,text) VALUES(?,?,?)', ch, i + 1, t.slice(0, 1500)); });
});
console.log(`第${ch}章：共 ${slides.length} 页，已入库 ${q.get('SELECT COUNT(*) n FROM kb_chunks WHERE chapter_id=?', ch).n} 页`);
