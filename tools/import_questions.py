# -*- coding: utf-8 -*-
"""Parse the 课后习题 Word files (第N章*.docx) into structured JSON.
Usage: python -I tools/import_questions.py <dir_with_docx> <out.json>
Rules follow PRD 2.3: sections are identified by heading text, not position."""
import sys, os, re, glob, json, docx

CH_RE = re.compile('第\\s*(\\d+)\\s*章')
SEC = [('single', ('单选',)), ('tf', ('判断',)), ('fill', ('填空',)), ('essay', ('简答', '问答', '主观', '论述'))]
HEAD = re.compile(r'^\s*[一二三四五六七八九十]\s*[、.．]\s*(.*)$')
QNUM = re.compile(r'^\s*(\d+)\s*[.．、]\s*(.*)$')
OPT = re.compile(r'^\s*([A-H])\s*[.．、:：]\s*(.*)$')
ANS_PAREN = re.compile(r'[（(]\s*([A-H]{1,4})\s*[）)]')
TF_PAREN = re.compile(r'[（(]\s*([√×✓✗✔✘对错TtFf])\s*[）)]')
BLANK = re.compile('\x01(.+?)\x02|_+\\s*([^_]+?)\\s*_+')


def norm(s):
    return s.replace(' ', ' ').replace('　', ' ').rstrip()


def para_text(p):
    out = []
    for r in p.runs:
        t = r.text
        if not t:
            continue
        if (r.bold or r.underline) and t.strip():
            out.append('\x01' + t + '\x02')
        else:
            out.append(t)
    return ''.join(out)


def strip_marks(s):
    return s.replace('\x01', '').replace('\x02', '')


def parse_single(raw):
    stem_lines, opts, cur = [], [], None
    for ln in raw:
        ln = strip_marks(ln)
        m = OPT.match(ln)
        if m:
            cur = [m.group(1), m.group(2).strip()]
            opts.append(cur)
        elif cur is not None:
            cur[1] = (cur[1] + ' ' + ln.strip()).strip()
        else:
            stem_lines.append(ln.strip())
    stem = ' '.join(stem_lines)
    ans = None
    ms = list(ANS_PAREN.finditer(stem))
    if ms:
        m = ms[-1]
        ans = m.group(1)
        stem = (stem[:m.start()] + stem[m.end():]).strip()
    elif opts:
        ma = list(ANS_PAREN.finditer(opts[-1][1]))
        if ma:
            ans = ma[-1].group(1)
            opts[-1][1] = (opts[-1][1][:ma[-1].start()] + opts[-1][1][ma[-1].end():]).strip()
    stem = re.sub(r'[（(]\s*[）)]', '（ ）', stem)
    return stem, opts, ans


def parse_tf(text):
    text = strip_marks(text)
    ms = list(TF_PAREN.finditer(text))
    if not ms:
        return text, None
    m = ms[-1]
    ans = m.group(1) in '√✓✔对Tt'
    return (text[:m.start()] + text[m.end():]).strip(), ans


def parse_fill(text):
    answers = []

    def rep(m):
        a = (m.group(1) or m.group(2)).strip()
        answers.append([x.strip() for x in re.split('[/／]', a) if x.strip()])
        return '____'
    stem = strip_marks(BLANK.sub(rep, text))
    return stem.strip(), answers


def parse_file(path, chapter, issues):
    d = docx.Document(path)
    lines = [norm(para_text(p)) for p in d.paragraphs]
    st = dict(sec=None, buf=[], no=None)
    items = {k: [] for k, _ in SEC}

    def flush():
        sec, raw, no = st['sec'], st['buf'], st['no']
        st['buf'], st['no'] = [], None
        if sec is None or not raw:
            return
        try:
            if sec == 'single':
                stem, opts, ans = parse_single(raw)
                ok = bool(stem) and len(opts) >= 2 and bool(ans) and all(c in [o[0] for o in opts] for c in ans)
                items['single'].append(dict(no=no, stem=stem, options=opts, answer=ans, ok=ok))
            elif sec == 'tf':
                stem, ans = parse_tf(' '.join(raw))
                items['tf'].append(dict(no=no, stem=stem, answer=ans, ok=ans is not None and bool(stem)))
            elif sec == 'fill':
                stem, answers = parse_fill(' '.join(raw))
                items['fill'].append(dict(no=no, stem=stem, answers=answers, ok=bool(answers)))
            elif sec == 'essay':
                body = strip_marks('\n'.join(raw))
                m = re.search(r'解析\s*[:：]', body)
                stem = body[:m.start()].strip() if m else body.strip()
                ana = body[m.end():].strip() if m else ''
                items['essay'].append(dict(no=no, stem=stem, analysis=ana, ok=bool(stem)))
        except Exception as e:  # keep going, report in the "to proofread" list
            issues.append(dict(chapter=chapter, sec=sec, no=no, error=str(e), raw=raw))

    for ln in lines:
        if not ln.strip():
            continue
        clean = strip_marks(ln)
        h = HEAD.match(clean)
        if h and len(h.group(1).strip()) < 12 and any(k in h.group(1) for _, ks in SEC for k in ks):
            flush()
            st['sec'] = next(name for name, ks in SEC if any(k in h.group(1) for k in ks))
            continue
        if st['sec'] is None:
            continue
        m = QNUM.match(clean)
        if m and not (st['sec'] == 'single' and OPT.match(clean)):
            flush()
            st['no'] = int(m.group(1))
            # keep the markers of the original line, minus the leading number
            st['buf'] = [re.sub(r'^\x01?\s*\d+\s*[.．、]\s*\x02?', '', ln, count=1)]
        elif st['buf']:
            st['buf'].append(ln)
    flush()
    return items


def main():
    src, out = sys.argv[1], sys.argv[2]
    files = [f for f in glob.glob(os.path.join(src, '*.docx')) if CH_RE.search(os.path.basename(f))]
    files.sort(key=lambda f: int(CH_RE.search(os.path.basename(f)).group(1)))
    result, issues, stats = [], [], {}
    for f in files:
        ch = int(CH_RE.search(os.path.basename(f)).group(1))
        for typ, arr in parse_file(f, ch, issues).items():
            for it in arr:
                it['chapter'], it['type'] = ch, typ
                result.append(it)
                s = stats.setdefault(ch, {}).setdefault(typ, [0, 0])
                s[0] += 1
                s[1] += 0 if it['ok'] else 1
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(dict(questions=result, issues=issues), fh, ensure_ascii=False)
    tot = bad = 0
    for ch in sorted(stats):
        print(ch, {k: tuple(v) for k, v in stats[ch].items()})
        for v in stats[ch].values():
            tot += v[0]
            bad += v[1]
    print('total', tot, 'need-review', bad, 'rate %.1f%%' % (100 * (tot - bad) / max(tot, 1)))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
