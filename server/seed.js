import fs from 'node:fs';
import path from 'node:path';
import { db, q, tx, J, ROOT, setSetting, getSetting } from './db.js';
const SEED_DIR = path.join(ROOT, 'data'); // read-only seed files shipped with the code; the DB itself lives in DATA_DIR
import { hashPassword } from './lib.js';

// Self-generated covers/spines (tools/gen_covers.mjs) served from web/assets/art; index 0..12 = chapters 1-11, mock exam, error book.
export const art = (i) => { const n = String(i + 1).padStart(2, '0'); return { spine_url: `/assets/art/spine-${n}.svg`, cover_url: `/assets/art/cover-${n}.svg` }; };

export const MODULES = [
  { id: 'basic', label: '基础', range: [1, 3] }, { id: 'tech', label: '技术', range: [4, 6] },
  { id: 'frontier', label: '前沿', range: [7, 9] }, { id: 'ethics', label: '应用与伦理', range: [10, 11] },
  { id: 'exam', label: '备考', range: [12, 13] },
];
const moduleOf = (n) => (MODULES.find((m) => n >= m.range[0] && n <= m.range[1]) || {}).id;

const CHAPTERS = [
  [1, '信息与计算机基础', 'INFORMATION & COMPUTING', '从信息、数据、编码到计算机硬件与软件系统，理解人工智能赖以运行的计算基础。',
    ['信息与数据、比特与编码', '冯·诺依曼体系结构与硬件组成', '操作系统与软件', '算法与程序、计算思维', '物联网、云计算、大数据与北斗等基础设施']],
  [2, '人工智能概述', 'AI OVERVIEW', '人工智能的定义、发展历程、三大学派与分类，认识弱人工智能、通用人工智能与超级人工智能。',
    ['图灵测试与达特茅斯会议', '符号主义、连接主义、行为主义', '三次浪潮与寒冬', '弱AI / AGI / ASI', '“人在机器之上”等设计原则']],
  [3, '人工智能的应用', 'AI APPLICATIONS', '人工智能在制造、家居、医疗、教育、交通等领域的典型应用场景与技术支撑。',
    ['数字孪生与智能工厂', '智能家居与分布式感知', '智慧医疗与辅助诊断', '智慧教育与个性化学习', '智能交通与自动驾驶']],
  [4, '机器学习', 'MACHINE LEARNING', '监督、无监督与强化学习的基本思想，常见算法、神经网络与深度学习，以及模型评估。',
    ['监督/无监督/强化学习', '回归、分类、聚类', '神经网络与反向传播', '过拟合与欠拟合、训练/验证/测试', '卷积神经网络与深度学习']],
  [5, '自然语言处理', 'NATURAL LANGUAGE PROCESSING', '让计算机理解和生成人类语言：分词、词向量、文本分类、机器翻译与问答。',
    ['分词与词性标注', '词向量与语言模型', '文本分类、情感分析与主题识别', '机器翻译与问答系统', '预训练模型的作用']],
  [6, '计算机视觉', 'COMPUTER VISION', '图像的表示与处理，图像分类、目标检测、人脸识别与图像生成。',
    ['像素与图像表示', '图像分类与目标检测', '人脸识别及其应用', '视觉任务中的卷积网络', '计算机视觉的行业应用']],
  [7, '大模型', 'LARGE MODELS', '大模型的特点、Transformer 架构、涌现能力、幻觉与 RAG，以及本地部署与应用。',
    ['参数规模与涌现能力', 'Transformer 架构', '幻觉与检索增强生成（RAG）', '提示词工程', '云端调用与本地部署（DeepSeek）']],
  [8, '智能体', 'AI AGENTS', '智能体的感知、规划、记忆与工具使用，多智能体协作与知识库、工作流平台。',
    ['智能体的概念与组成', '规划、记忆、工具调用', '多智能体协作', '知识库与工作流', '智能体的风险与边界']],
  [9, '具身智能', 'EMBODIED AI', '拥有身体的智能：感知—决策—行动闭环，机器人、自动驾驶与世界模型。',
    ['具身智能的概念', '感知—决策—控制闭环', '人形机器人与自动驾驶', '世界模型', '仿真训练与现实迁移']],
  [10, 'AIGC 应用与实践', 'AIGC IN PRACTICE', '文本、图像、语音、视频生成式 AI 的原理、代表产品与提示词实践。',
    ['文本/图片/语音/视频类 AIGC', '提示词的作用与技巧', 'AIGC 对职业的影响', '深度伪造与内容治理', '版权与学术诚信']],
  [11, '人工智能伦理', 'AI ETHICS', '算法偏见、隐私安全、责任归属、就业影响与人工智能治理原则。',
    ['算法偏见与公平', '隐私与数据安全', '责任归属与可解释性', '就业与社会影响', '治理原则与法规']],
];

export function seed() {
  // chapters
  if (!q.get('SELECT 1 x FROM chapters LIMIT 1')) {
    tx(() => CHAPTERS.forEach(([id, title, en, summary, points], i) => {
      const a = art(i);
      q.run('INSERT INTO chapters(id,title,title_en,module,cover_url,spine_url,summary,points) VALUES(?,?,?,?,?,?,?,?)',
        id, title, en, moduleOf(id), a.cover_url, a.spine_url, summary, J(points));
    }));
  }
  // databases created with the old placeholder art get the self-hosted covers
  for (let i = 0; i < 11; i++) { const a = art(i); q.run("UPDATE chapters SET cover_url=?, spine_url=? WHERE id=? AND cover_url LIKE 'http%'", a.cover_url, a.spine_url, i + 1); }
  // questions
  if (!q.get('SELECT 1 x FROM questions LIMIT 1')) {
    const f = path.join(SEED_DIR, 'questions.json');
    if (fs.existsSync(f)) {
      const { questions, issues } = JSON.parse(fs.readFileSync(f, 'utf8'));
      tx(() => {
        for (const x of questions) importQuestion(x, 'textbook');
        for (const s of issues || []) q.run('INSERT INTO import_issues(chapter_id,sec,no,raw,created_at) VALUES(?,?,?,?,?)', s.chapter, s.sec, s.no, J(s.raw), Date.now());
      });
    }
    const e = path.join(SEED_DIR, 'essays_seed.json');
    if (fs.existsSync(e)) {
      tx(() => JSON.parse(fs.readFileSync(e, 'utf8')).forEach((x) =>
        importQuestion({ ...x, type: 'essay', ok: true, no: null }, 'seed')));
    }
  }
  // lecture-slide text for AI explanations (exported by tools/export_kb.mjs)
  if (!q.get('SELECT 1 x FROM kb_chunks LIMIT 1')) {
    const k = path.join(SEED_DIR, 'kb.json');
    if (fs.existsSync(k)) tx(() => JSON.parse(fs.readFileSync(k, 'utf8')).forEach((r) => q.run('INSERT INTO kb_chunks(chapter_id,slide_no,text) VALUES(?,?,?)', r.c, r.s, r.t)));
  }
  // extra knowledge: 课后习题 (题干+答案+解析) and 第9章 智能体框架WorkBuddy 第2版 (built by tools/build_kb_extra.py)
  if (!q.get("SELECT 1 x FROM kb_chunks WHERE src<>'slide' LIMIT 1")) {
    const k = path.join(SEED_DIR, 'kb_extra.json');
    if (fs.existsSync(k)) tx(() => JSON.parse(fs.readFileSync(k, 'utf8')).forEach((r) => q.run('INSERT INTO kb_chunks(chapter_id,slide_no,text,src) VALUES(?,?,?,?)', r.c, r.s, r.t, r.x)));
  }
  // model prices (editable by admin; defaults follow PRD 5.3)
  if (!q.get('SELECT 1 x FROM model_prices LIMIT 1')) {
    const now = Date.now();
    for (const r of [['deepseek', 'deepseek-flash', 0.30, 1.20], ['deepseek', 'deepseek-v4-pro', 1.05, 4.20], ['tokenone', 'default', 0.30, 1.20], ['mock', 'demo', 0, 0]])
      q.run('INSERT INTO model_prices VALUES(?,?,?,?,?,?,?)', r[0], r[1], r[2], r[3], 'USD', 7.1, now);
  }
  q.run("DELETE FROM api_keys WHERE scope='global'"); // admin-managed keys were removed
  // accounts
  if (!q.get("SELECT 1 x FROM users WHERE role='admin'")) {
    q.run('INSERT INTO users(role,username,name,password_hash,must_change_pwd,created_at) VALUES(?,?,?,?,?,?)',
      'admin', 'admin', '系统管理员', hashPassword(process.env.ADMIN_PASSWORD || 'Admin@2026'), 1, Date.now());
    console.log('[init] 管理员账号 admin / ' + (process.env.ADMIN_PASSWORD || 'Admin@2026') + '（首次登录需改密）');
  }
  const defaults = { default_password_digits: 6, final_exam_date: '', rewrite_enabled: false, college_default: '机械工程学院' };
  for (const [k, v] of Object.entries(defaults)) if (getSetting(k) === null) setSetting(k, v);
}

export function importQuestion(x, source = 'textbook', extra = {}) {
  const t = x.type;
  let options = null, answer = null, blanks = 0;
  if (t === 'single') { options = x.options.map(([k, v]) => ({ key: k, text: v })); answer = x.answer; }
  else if (t === 'tf') answer = !!x.answer;
  else if (t === 'fill') { answer = x.answers; blanks = x.answers.length; }
  return q.run(`INSERT INTO questions(chapter_id,type,stem,options,answer,blank_count,analysis,source,status,no,owner_id,scope)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, x.chapter, t, x.stem, J(options), J(answer), blanks, x.analysis || '',
  source, x.ok === false ? 'draft' : 'active', x.no ?? null, extra.owner_id ?? null, extra.scope ?? 'all').lastInsertRowid;
}
