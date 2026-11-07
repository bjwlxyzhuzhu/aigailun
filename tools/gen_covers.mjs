// Generates the 13 self-hosted VHS covers (474x900) and spines (142x840) as SVG into web/assets/art/.
//   node tools/gen_covers.mjs        (output is committed; rerun only to change the artwork)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/assets/art');
fs.mkdirSync(OUT, { recursive: true });
const SERIF = `'Noto Serif SC','Source Han Serif SC','Songti SC','STSong','SimSun',serif`;
const SANS = `'Inter','Helvetica Neue','Arial',sans-serif`;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// [no, title, english, bg, ink, accent]
const T = [
  [1, '信息与计算机基础', 'INFORMATION & COMPUTING', '#E6E1D3', '#1B1A17', '#1F3FB0'],
  [2, '人工智能概述', 'AI OVERVIEW', '#D9DFE8', '#14213D', '#C8452C'],
  [3, '人工智能的应用', 'AI APPLICATIONS', '#EADFD0', '#2A1D12', '#1F3FB0'],
  [4, '机器学习', 'MACHINE LEARNING', '#DDE5DA', '#16241A', '#C8452C'],
  [5, '自然语言处理', 'NATURAL LANGUAGE PROCESSING', '#E8DCDC', '#2B1717', '#1F3FB0'],
  [6, '计算机视觉', 'COMPUTER VISION', '#D6E0E3', '#10262B', '#D98A1F'],
  [7, '大模型', 'LARGE MODELS', '#14213D', '#EDEBE6', '#F2B84B'],
  [8, '智能体', 'AI AGENTS', '#E5E2D0', '#222010', '#1F3FB0'],
  [9, '具身智能', 'EMBODIED AI', '#DCD6E6', '#1E1630', '#C8452C'],
  [10, 'AIGC 应用与实践', 'AIGC IN PRACTICE', '#F0DCC8', '#2E1A0B', '#1F3FB0'],
  [11, '人工智能伦理', 'AI ETHICS', '#D8E3DD', '#0F2A20', '#B02F2F'],
  [12, '模拟考试', 'MOCK EXAM', '#1F3FB0', '#EDEBE6', '#F2B84B'],
  [13, '我的错题本', 'ERROR BOOK', '#EDEBE6', '#1B1A17', '#C8452C'],
];

// Motifs are drawn in a 474x500 box (origin top-left). c = ink, a = accent.
const M = {
  1: (c, a) => { let s = ''; for (let y = 0; y < 10; y++) for (let x = 0; x < 8; x++) { const on = rnd() > .5; s += `<text x="${40 + x * 52}" y="${60 + y * 46}" font-family="${SANS}" font-size="36" font-weight="600" fill="${on ? a : c}" opacity="${on ? 1 : .22}">${on ? 1 : 0}</text>`; } return s; },
  2: (c, a) => { let s = ''; for (let i = 0; i < 7; i++) s += `<rect x="${237 - 190 + i * 24}" y="${250 - 190 + i * 24}" width="${380 - i * 48}" height="${380 - i * 48}" fill="none" stroke="${i % 3 ? c : a}" stroke-width="${i % 3 ? 2 : 5}"/>`; return s + `<circle cx="237" cy="250" r="12" fill="${a}"/>`; },
  3: (c, a) => { let s = ''; for (let r = 0; r < 5; r++) for (let k = 0; k < 8 + r * 5; k++) { const ang = (k / (8 + r * 5)) * Math.PI * 2, R = 40 + r * 44; s += `<circle cx="${237 + Math.cos(ang) * R}" cy="${250 + Math.sin(ang) * R}" r="${5 + r}" fill="${(k + r) % 4 ? c : a}" opacity="${(k + r) % 4 ? .8 : 1}"/>`; } return s; },
  4: (c, a) => { let s = `<line x1="40" y1="440" x2="440" y2="70" stroke="${a}" stroke-width="5"/>`; for (let i = 0; i < 46; i++) { const x = 50 + rnd() * 380, y = 440 - (x - 40) * 0.925 + (rnd() - .5) * 140; s += `<circle cx="${x}" cy="${Math.max(40, Math.min(470, y))}" r="${5 + rnd() * 5}" fill="${c}" opacity=".8"/>`; } return s + `<path d="M40 40V460H440" fill="none" stroke="${c}" stroke-width="2"/>`; },
  5: (c, a) => { let s = ''; for (let i = 0; i < 11; i++) { let x = 40; const y = 50 + i * 40; while (x < 400) { const w = 24 + rnd() * 70; s += `<rect x="${x}" y="${y}" width="${w}" height="14" rx="7" fill="${(i * 3 + Math.floor(x)) % 5 === 0 ? a : c}" opacity="${.35 + rnd() * .5}"/>`; x += w + 12; } } return s; },
  6: (c, a) => { let s = ''; for (let y = 0; y < 12; y++) for (let x = 0; x < 10; x++) { const d = Math.hypot(x - 4.5, y - 5.5), on = d < 4.2; s += `<rect x="${37 + x * 40}" y="${20 + y * 40}" width="38" height="38" fill="${on ? (d < 2 ? a : c) : c}" opacity="${on ? .35 + (1 - d / 4.2) * .65 : .1}"/>`; } return s; },
  7: (c, a) => { const L = [4, 7, 9, 7, 4], xs = [60, 150, 237, 324, 414]; let s = '', pts = L.map((n, i) => Array.from({ length: n }, (_, j) => [xs[i], 250 + (j - (n - 1) / 2) * 50])); pts.slice(0, -1).forEach((A, i) => A.forEach((p) => pts[i + 1].forEach((q) => { s += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${c}" stroke-width="1" opacity=".22"/>`; }))); pts.flat().forEach((p, i) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="${i % 7 === 0 ? 11 : 7}" fill="${i % 7 === 0 ? a : c}"/>`; }); return s; },
  8: (c, a) => `<circle cx="237" cy="250" r="170" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="3 9"/><circle cx="237" cy="250" r="105" fill="none" stroke="${c}" stroke-width="2"/><circle cx="237" cy="250" r="34" fill="${a}"/>` + [0, 1, 2, 3, 4].map((k) => { const g = k * 1.2566 - 1.2, R = k % 2 ? 105 : 170; return `<circle cx="${237 + Math.cos(g) * R}" cy="${250 + Math.sin(g) * R}" r="16" fill="${c}"/><line x1="237" y1="250" x2="${237 + Math.cos(g) * R}" y2="${250 + Math.sin(g) * R}" stroke="${a}" stroke-width="2"/>`; }).join(''),
  9: (c, a) => `<g fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><path d="M110 460 V400 L210 300 L330 330 L390 150"/></g><g fill="${a}"><circle cx="110" cy="400" r="24"/><circle cx="210" cy="300" r="24"/><circle cx="330" cy="330" r="24"/></g><path d="M368 118 L412 118 L390 74 Z M366 150 L346 100 M414 150 L434 100" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/><rect x="50" y="456" width="150" height="26" fill="${c}"/>`,
  10: (c, a) => ['#1F3FB0', '#C8452C', '#F2B84B'].map((k, i) => `<circle cx="${160 + i * 80}" cy="${i === 1 ? 300 : 200}" r="120" fill="${k}" opacity=".62" style="mix-blend-mode:multiply"/>`).join('') + `<circle cx="237" cy="250" r="8" fill="${c}"/>`,
  11: (c, a) => `<g stroke="${c}" stroke-width="8" fill="none" stroke-linecap="round"><line x1="237" y1="70" x2="237" y2="430"/><line x1="110" y1="140" x2="364" y2="140" transform="rotate(-7 237 140)"/><path d="M150 430H324"/></g><g fill="none" stroke="${c}" stroke-width="3"><path d="M110 140 L70 280 H150 Z" transform="translate(-0 -7)"/><path d="M364 140 L324 280 H404 Z" transform="translate(0 7)"/></g><circle cx="237" cy="70" r="14" fill="${a}"/><ellipse cx="110" cy="285" rx="40" ry="8" fill="${a}" opacity=".85"/><ellipse cx="364" cy="293" rx="40" ry="8" fill="${a}" opacity=".35"/>`,
  12: (c, a) => { let s = `<circle cx="237" cy="260" r="165" fill="none" stroke="${c}" stroke-width="6"/>`; for (let i = 0; i < 60; i++) { const g = (i / 60) * Math.PI * 2, L = i % 5 ? 10 : 24; s += `<line x1="${237 + Math.cos(g) * 165}" y1="${260 + Math.sin(g) * 165}" x2="${237 + Math.cos(g) * (165 - L)}" y2="${260 + Math.sin(g) * (165 - L)}" stroke="${c}" stroke-width="${i % 5 ? 2 : 4}"/>`; } return s + `<path d="M237 260 L237 140 M237 260 L320 300" stroke="${a}" stroke-width="10" stroke-linecap="round"/><circle cx="237" cy="260" r="12" fill="${a}"/><rect x="217" y="60" width="40" height="22" fill="${c}"/>`; },
  13: (c, a) => { let s = ''; for (let i = 0; i < 6; i++) { const y = 40 + i * 78; s += `<rect x="50" y="${y}" width="${150 + (i * 53) % 190}" height="14" fill="${c}" opacity=".2"/><rect x="50" y="${y + 24}" width="${230 - (i * 37) % 120}" height="14" fill="${c}" opacity=".12"/>`; if (i % 2 === 0) s += `<path d="M${330 + i * 6} ${y - 4} l50 50 m0 -50 l-50 50" stroke="${a}" stroke-width="10" stroke-linecap="round" fill="none"/>`; else s += `<path d="M${330 + i * 6} ${y + 20} l18 22 l38 -48" stroke="${c}" stroke-width="8" stroke-linecap="round" fill="none" opacity=".5"/>`; } return s + `<path d="M40 470 C150 440 300 500 440 455" stroke="${a}" stroke-width="5" fill="none"/>`; },
};

const esc = (s) => s.replace(/&/g, '&amp;');
for (const [no, title, en, bg, ink, acc] of T) {
  const id = String(no).padStart(2, '0');
  seed = no * 97;
  const small = title.length > 7;
  const cover = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 474 900" width="474" height="900">
<rect width="474" height="900" fill="${bg}"/>
<rect x="0" y="0" width="474" height="900" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width="2"/>
<text x="28" y="48" font-family="${SANS}" font-size="15" letter-spacing="3" fill="${ink}">№ ${id} / 13</text>
<text x="446" y="48" text-anchor="end" font-family="${SERIF}" font-size="15" letter-spacing="2" fill="${ink}">人工智能概论</text>
<line x1="28" y1="64" x2="446" y2="64" stroke="${ink}" stroke-opacity=".5"/>
<g transform="translate(0 100)">${M[no](ink, acc)}</g>
<rect x="28" y="640" width="64" height="8" fill="${acc}"/>
<text x="28" y="716" font-family="${SERIF}" font-size="${small ? 46 : 62}" font-weight="700" fill="${ink}">${esc(title)}</text>
<text x="28" y="760" font-family="${SANS}" font-size="${en.length > 20 ? 12 : 15}" letter-spacing="${en.length > 20 ? 2.5 : 4}" fill="${ink}" opacity=".8">${esc(en)}</text>
<line x1="28" y1="810" x2="446" y2="810" stroke="${ink}" stroke-opacity=".5"/>
<text x="28" y="842" font-family="${SERIF}" font-size="16" letter-spacing="3" fill="${ink}" opacity=".85">智能练考平台 · 期末备考</text>
<text x="446" y="842" text-anchor="end" font-family="${SANS}" font-size="13" letter-spacing="2" fill="${ink}" opacity=".6">VHS ${id}</text>
<rect x="28" y="862" width="418" height="10" fill="${acc}" opacity=".9"/>
</svg>`;
  const sp = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 142 840" width="142" height="840">
<rect width="142" height="840" fill="${bg}"/>
<rect x="0" y="0" width="142" height="840" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width="2"/>
<rect x="0" y="0" width="142" height="86" fill="${acc}"/>
<text x="71" y="58" text-anchor="middle" font-family="${SANS}" font-size="36" font-weight="700" fill="${no === 7 || no === 12 ? '#14213D' : '#fff'}">${id}</text>
<text transform="translate(86 790) rotate(-90)" font-family="${SERIF}" font-size="${title.length > 7 ? 42 : 52}" font-weight="700" fill="${ink}">${esc(title)}</text>
<text transform="translate(120 790) rotate(-90)" font-family="${SANS}" font-size="12" letter-spacing="3" fill="${ink}" opacity=".6">${esc(en.length > 22 ? en.slice(0, 22) + '…' : en)}</text>
<rect x="18" y="112" width="106" height="4" fill="${ink}" opacity=".5"/>
<circle cx="71" cy="140" r="9" fill="none" stroke="${ink}" stroke-opacity=".5" stroke-width="2"/>
</svg>`;
  fs.writeFileSync(path.join(OUT, `cover-${id}.svg`), cover);
  fs.writeFileSync(path.join(OUT, `spine-${id}.svg`), sp);
}
console.log('wrote', T.length * 2, 'files to', OUT);
