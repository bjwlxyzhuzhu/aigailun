# 《人工智能概论》智能练考平台

按 PRD 与《Leon Vasari VHS filmography shelf hero》提示词实现：学生端 VHS 书架首页 + 自测练习 / 自动组卷 / 模拟考试 / 错题本；教师端导入学生、题库、班级模拟考、统计导出；管理员端教师账号、全局 Key、价格表、知识库、用量与审计。

## 运行

需要 **Node ≥ 22.5**（使用内置 `node:sqlite`，**零 npm 依赖**，无需 `npm install`）。

```bash
npm start            # http://localhost:3000
```

首次启动自动建库并导入：599 道课后习题 + 30 道补充综合分析题 + 811 页讲义文字（知识库）。
管理员 `admin / Admin@2026`（首次登录强制改密；可用环境变量 `ADMIN_PASSWORD` 指定）。

体验用示范数据（仅开发环境）：`node tools/demo_seed.mjs`，会创建教师 `teacher01`、16 名示范学生（`data/sample_students_gbk.csv`，GBK 编码，正好演示导入）。

| 环境变量 | 说明 |
| --- | --- |
| `PORT` | 端口，默认 3000 |
| `DATA_DIR` | 数据库与密钥目录，默认 `./data`（Docker 中为 `/data`，请挂载卷） |
| `PYTHON` | 在线上传 Word 习题时调用的 python（需 `python-docx`），默认 `python` |

部署：`docker build -t ai-exam . && docker run -p 3000:3000 -v exam-data:/data ai-exam`，前面套一层 HTTPS 反代（PRD 要求）。

## 目录

```
server/    http.js 路由与静态文件 · db.js 表结构 · core.js 判分/组卷/错题本 · ai.js 模型调用与计费
           student.js 学生与考试接口 · teacher.js 教师接口 · admin.js 管理接口 · seed.js 初始数据
web/       index.html · css/ (app.css 令牌与内页, shelf.css 书架) · js/shelf.js (书架，原生无库)
           js/pages/ 各页面 · assets/fonts/ 自托管字体
tools/     import_questions.py (Word→JSON) · import_kb.mjs / export_kb.mjs (PPT 知识库) · fetch_fonts.mjs
           smoke.mjs (50 项端到端测试: npm test) · demo_seed.mjs
data/      questions.json / essays_seed.json / kb.json 种子数据（可重新生成）
```

## 已实现（对照 PRD）

- **题库**：Word 按小节标题解析，题量与 PRD 完全一致（313 单选 / 128 判断 / 140 填空(148 空) / 18 简答），解析成功率 100%；教师可在线校对、增删、停用、上传 Word 增量入库；第 7–11 章综合分析题补到每章 ≥ 6（共 30，**为种子题，请教师审核**）。
- **组卷**：标准卷恰为 50 单选 + 10 空 + 10 判断 + 3 综合 = 100 分，综合题来自第 7–11 章 3 个不同章节，同卷题干相似度 > 0.8 去重，题目与选项每次随机；自定义卷（章节/题量/薄弱优先/错题优先）；AI 新出题（需 Key）。
- **作答**：自测练习（点选即判、续答、顺序/随机/未做/做错）；模拟考试 90 分钟服务器计时、每 30 秒与改动时自动保存、刷新/换设备续答、到时自动交卷（服务端每 20 秒扫描）、交卷前不下发答案；班级模拟考试（时间窗、统一卷/每人一卷、可重开）。
- **批改**：客观题自动（填空同义词表、忽略空格/全半角/大小写）；主观题有 Key 时 AI 四维度评分并可被教师改分，无 Key 时对照要点自评；少于 20 字直接 0 分，疑似注入标“需人工复核”。
- **错题本**：自动收录、连对 2 次掌握、重练、错题组卷、打印、AI 诊断。
- **AI / Key**：个人 → 班级 → 全局三层 Key；DeepSeek / tokenone 中转 / 演示模式（不联网，用于体验流程）；AES-256-GCM 加密，浏览器不直连模型；调用前预估花费、> ¥0.1 二次确认、每日限额、用量记账、价格表可配。
- **教师**：GBK/UTF-8 CSV 与 xlsx 导入（列映射预览、校验、重复学号更新）、班级总览、学生详情、高错题分析、班级考试统计、成绩与练习明细导出、匿名作答日志导出（科研）。
- **前端**：书架按提示词逐条实现（3D 长方体、`F(r)/B(r)` 排布、开合度、悬停抽出、光标倾斜、三份拷贝循环、纸张展开、墨迹渗入、遮罩上滑字幕、圆环光标四态、无 opacity 淡入、reduced-motion）；帧率 < 30fps 持续 2 秒自动切“简版”；考试/练习页恢复原生光标。

## 与 PRD 的取舍（可后续替换）

| PRD | 当前实现 | 原因 |
| --- | --- | --- |
| Vue 3 + Vite + TS | 原生 ES 模块，无构建 | 零依赖、可直接部署；书架本就要求无框架 |
| Fastify/FastAPI + PostgreSQL + Redis | Node 内置 http + SQLite(WAL) + 内存队列 | 单文件库、300 人并发足够；数据层集中在 `db.js`，需要时可迁移 |
| 导出 PDF | 生成可打印页面，浏览器“打印 → 另存为 PDF” | 免去无头浏览器依赖 |
| 导出 Excel | CSV（带 BOM，Excel 直接打开） | 同上 |
| bcrypt | scrypt（Node 内置） | 同等强度、无依赖 |

## 上线前待办 / 待确认（PRD §8.4）

1. **封面与书脊**：已用 `node tools/gen_covers.mjs` 生成 13 盒 × 2 张自托管 SVG（`web/assets/art/`，中文章名、无外链）。这是程序绘制的矢量插画；如要换成设计稿/AI 绘图，把同名文件（cover-01…13.svg，474×900；spine-01…13.svg，142×840，也可用 webp 并改 `server/seed.js` 的 `art()`）替换即可。旧库启动时自动迁移。
2. **tokenone.work**：接口地址与模型名待确认，在【我的 → AI 设置】或管理后台里填写；`deepseek-v4-pro` 价格为估算，请在管理后台价格表核对。
3. 期末笔试日期（管理后台 → 设置，决定书架右上角倒计时）、子域名、是否开放“换个问法”、全局 Key 是否对学生开放。
4. 字体：`NODE_USE_ENV_PROXY=1 node tools/fetch_fonts.mjs` 重新下载/子集化（已附带生成好的文件）。
5. 压测：`node tools/loadtest.mjs [人数] [自动保存轮数]`（见下“性能”）。真机部署后请在目标服务器上再跑一次。
6. 本期未做：二期的积分商城与签到、督导只读角色、教师调整 AI 评分维度的界面（后端会读取 settings 表的 `essay_rubric`，格式 `[["维度",分值],…]`，暂无界面）。

## 性能（300 人压测）

`node tools/loadtest.mjs 300`：300 名学生同时完成 登录→改密→组卷→开考→6 轮自动保存→交卷→看报告（本机 24 核）。

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| 完成人数 | 243/300（57 次连接被拒/重置） | 300/300，0 错误 |
| 自动保存 p95 | 1848 ms（max 14 s） | 396 ms |
| 组卷 p95 | 5.4 s | 423 ms |
| 事件循环停顿 p95 | 10.6 s | 0.2 s |
| 全程 | 61 s | 23 s |

600 人同样 0 错误（自动保存 p95 460 ms）。主要改动：scrypt 改为线程池异步并限并发（原同步哈希会在登录高峰冻结整个服务）；
预编译语句缓存；静态文件内存缓存 + gzip + ETag；监听 backlog 2048；SQLite `synchronous=NORMAL`（WAL 下仍可抵御进程崩溃）。

仍需注意：登录是 CPU 密集（scrypt），课堂开考瞬间 300 人同时登录时排队约数秒到十余秒，取决于服务器核数；令牌有效期 7 天，
建议学生考前一天先登录一次，考试当天直接用已登录状态。

## 测试

`npm test` 启动一个临时服务实例，走完账号、GBK 导入、练习、标准卷、续答、交卷、AI 批改、班级考试、权限等 50 项检查。
