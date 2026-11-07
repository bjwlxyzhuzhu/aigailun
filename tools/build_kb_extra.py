"""Build data/kb_extra.json: extra knowledge-base chunks beyond the lecture slides.
  python -I tools/build_kb_extra.py <questions.json> <第9章 WorkBuddy.pdf> data/kb_extra.json
Rows: {c: chapter id, s: page/no, t: text, x: source}  x = 'exercise' (课后习题) | 'wb9' (第9章 智能体框架WorkBuddy 第2版)
The WorkBuddy chapter is filed under platform chapter 8 (智能体): the 2026 exercise set still numbers 智能体=8, 具身智能=9."""
import json, re, sys
import pymupdf

qf, pdf, out = sys.argv[1:4]
rows = []
for q in json.load(open(qf, encoding='utf8'))['questions']:
    t = '【题目】' + q['stem']
    if q.get('options'): t += ' ' + ' '.join(f'{k}.{v}' for k, v in q['options'])
    a = q.get('answers') if q['type'] == 'fill' else q.get('answer')
    if a is not None: t += '【答案】' + (('、'.join('/'.join(x) for x in a)) if isinstance(a, list) else str(a))
    if q.get('analysis'): t += '【解析】' + q['analysis']
    rows.append({'c': q['chapter'], 's': q.get('no') or 0, 't': t[:900], 'x': 'exercise'})
n_ex = len(rows)
doc = pymupdf.open(pdf)
for i, page in enumerate(doc, 1):
    txt = re.sub(r'\n(?=\S)', '', page.get_text())  # PDF hard line wraps
    txt = re.sub(r'^\s*(《?人工智能通识教程》?.*?\n|西安.*?内部教学使用\n|\d+\n)', '', txt)
    txt = re.sub(r'[ \t]+', ' ', txt).strip()
    for j in range(0, len(txt), 1000):
        piece = txt[j:j + 1000].strip()
        if len(piece) > 30: rows.append({'c': 8, 's': i, 't': piece, 'x': 'wb9'})
json.dump(rows, open(out, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
print('exercise', n_ex, 'wb9', len(rows) - n_ex)
