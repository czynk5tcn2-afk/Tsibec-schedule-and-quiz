> **直接把这个仓库丢给你的 AI 就行**：让它读完这份 README，告诉它你想改什么（换成自己的课表、换题库、改颜色……），它就知道该动哪个文件。

# 课程表 + 复习刷题页（小克版 · 作品集示例）

一个纯静态的手机网页，包含两部分：

- **课程表**（`index.html`）：周视图课表，左栏上下课时间，顶部“现在 / 下一节”提示，考试倒数，导出到手机日历，可安装到主屏幕、能离线打开。另有一个夸张的 **WebGL 实验模式**（开场转场、“坠入水晶球”切页、心电扫描、细胞分裂等彩蛋）。
- **复习刷题页**（`study.html`）：多巴胺撞色风格。每科有考点卡（收藏 / 记住了 / 乱序抽卡）、高频页（编号可点跳转）、刷题（错题本、随机顺序、可信度筛选、“来 10 题”快练、题目反馈复制）、主观题背诵、计时模拟卷。做题记录只存在本机浏览器里，不需要登录。

**在线演示**：https://tsibec-schedule-and-quiz.czynk5tcn2.workers.dev （课程表）· [复习页](https://tsibec-schedule-and-quiz.czynk5tcn2.workers.dev/study)，手机打开效果最好。

仓库里的课程、考试、题目**全部是虚构的示例**，只用来演示功能。

没有框架、没有构建步骤：原生 HTML / CSS / JavaScript，改完文件刷新浏览器就能看到。

---

## 快速开始

```bash
cd site
python3 -m http.server 8000
```

打开 http://localhost:8000 （课程表）和 http://localhost:8000/study.html （复习页）。

> 必须通过本地服务器打开，直接双击 html 文件会因为浏览器安全限制读不到题库数据。

**进入实验模式**：点右上角“点我” → “启动实验模式”，或者 10 秒内连点标题“课程表” 15 下。系统开了“减少动态效果”时只显示静态暗场。

---

## 目录结构

```
site/                    ← 整个文件夹就是网站，部署时上传它
  index.html             课程表（单文件：数据、样式、逻辑都在里面）
  showcase-xk2.js/.css   实验模式引擎（WebGL2），进入实验模式时才加载
  pwa-v4.js              注册离线缓存、新版本提示、安装引导
  sw.js                  Service Worker（离线缓存规则）
  _headers               缓存头和安全策略（Cloudflare Pages / Netlify 认这个文件）
  manifest.webmanifest   安装到主屏幕用
  calendar.ics           日历订阅文件，由 make-calendar.js 生成，不要手改
  study.html/.css/.js    复习刷题页
  study-data/*.json      题库数据，由 tools/build-sample.js 生成，不要手改
  study-img/nya-cry.jpg  “整理中”科目的哭哭图（网络表情包）
  icons/                 图标
make-calendar.js         从 index.html 的课程数据生成 calendar.ics
tools/build-sample.js    题库源文件 + 生成脚本
```

---

## 换成自己的课表

都在 `site/index.html` 开头的 `<script>` 里：

| 改什么 | 在哪 | 说明 |
|---|---|---|
| 开学日期、总周数 | `SEMESTER` | `firstWeekStartDate` 写开学第一周的**周一** |
| 上下课时间 | `CLASS_TIMES` | 第 N 节 = 第 N 个 `[上课, 下课]` |
| 课程 | `COURSES` | 每行 `[课程名, 地点, 星期1–7, 起始节, 结束节, 周次, 颜色]`；周次写法 `"1-16"`、`"1-8,10"`、`"3-15(单)"`、`"4-16(双)"` |
| 考试 | `EXAMS` | `{ course, date:"YYYY-MM-DD", time, place, note }`，空数组时考试页显示占位文案 |
| 关掉演示模式 | `DEMO_MODE` | 改成 `false`。演示模式会把“这周”固定当成第 7 周、考试排在几天后，方便任何时候打开都有内容 |
| 课程卡短名 | `shortNames` | 课名太长时卡片上显示的简称 |
| 课程卡配色 | CSS 里的 `[data-course-name="课程名"]` | 浅色、深色、实验暗场各一套；没配的课用默认色 |
| 地点简写 | `shortPlace()` | 默认取地点末尾的 “A101” 这类房间号 |

改完课程、作息或考试后运行：

```bash
node make-calendar.js          # 重新生成 site/calendar.ics
node make-calendar.js --check  # 只检查是不是最新
```

---

## 换成自己的题库

1. 打开 `tools/build-sample.js`，照着 `SUBJECTS` 里两个示例科目的格式写自己的内容（文件开头注释里有每个字段的说明）。
2. 运行 `node tools/build-sample.js`，会重新生成 `site/study-data/` 下的 JSON。
3. `site/study.js` 开头改署名：`AUTHOR`（整理者）和 `CONTACT`（发现问题找谁）。

要点：

- 选择题状态 `st`：`ok` 有依据、`q` 未核实、`warn` 看条件、`stop` 不计分（不计分的题默认隐藏，也不算进进度）。
- 题号要在全科唯一；考点卡的 `refs`、高频页里出现的题号会自动变成可点的按钮。
- 主观题 `id` 为空的条目不能标“背会了”，适合放说明文字。
- 还没整理好的科目写进 `PENDING`，首页显示 `note`，点开出哭哭图（换图改 `study.js` 开头的 `NYA`）。
- 题目多的话（上千道）也没问题，每科数据点进该科才加载。

---

## 发新版本（避免手机一直用旧缓存）

每次改了网页文件，把版本号（例如 `xk17-20261008`）在这几处一起改成新的：

1. `site/sw.js`：第一行注释和 `const V=`
2. `site/index.html`：`ASSET_V`，以及 `<head>` 里 `pwa-v4.js?v=`
3. `site/study.html`：`<html data-v=...>`，以及 `study.css?v=`、`study.js?v=`

JS / CSS 的网址带版本号，版本变了浏览器一定会去拿新文件；首页是“联网优先”，打开就是最新版。

---

## 部署

网站里的链接都是从根路径开始的（`/study`、`/sw.js`），所以要部署在**域名根目录**：

- **Cloudflare Workers 静态资源**（演示站用的就是这个，免费）：仓库根目录的 `wrangler.jsonc` 已经配好（把 `name` 改成你自己的项目名），运行 `npx wrangler deploy` 即可，会得到一个 `*.workers.dev` 地址。`_headers` 照样生效，`/study` 也能直接访问。
- **Cloudflare Pages**（推荐，免费）：新建项目 → Direct Upload 上传 `site` 文件夹；或者用命令 `npx wrangler pages deploy site --project-name=<你的项目名>`。`_headers` 会自动生效，`/study` 也能直接访问。
- Netlify、Vercel 同理，发布目录选 `site`。
- GitHub Pages 的“项目页”地址带子路径（`用户名.github.io/仓库名/`），直接用会找不到文件；要用的话需绑定自定义域名，或者放在 `用户名.github.io` 仓库里。

---

## 给 AI 的注意事项

- 原生 HTML/CSS/JS，**不要引入框架或构建工具**。改完刷新即可验证。
- `study-data/*.json` 和 `calendar.ics` 是生成出来的，改源文件后重新运行脚本，不要手改。
- 本机存储（`localStorage`）的读写都包了 `try/catch`，浏览器禁用存储时页面照常能用，新代码也要这样写。
- 所有动画在系统“减少动态效果”时要关掉（CSS 里有 `prefers-reduced-motion`，JS 里看 `calm` / `reduceMotion` 变量）。
- 页面要在 320px 宽的手机上不出现横向滚动；深色模式跟随系统。复习页在 960px 以上有电脑版布局。
- 改了网页文件记得按上面“发新版本”改版本号。
- 普通模式的课表追求不卡顿，特效集中在实验模式里。

## 彩蛋（剧透）

<details><summary>点开看</summary>

- 课程表：连点标题 5 下课程卡波浪；“点我”是今日心情卡（13 种心情，1/15 抽到隐藏款）；深夜打开有提示；考试页水晶球连点会晃。
- 实验模式：空白处长按心电扫描；从课表外快速划出光刀；连点三下细胞分裂；控制台可重播六个场景。
- 复习页：页头色块连点 5 下讲冷笑话、15 下“拆首页”；考点搜索框搜作者名、“必过”、“喵”、“摸鱼”；答对撒纸屑、连对和进度里程碑庆祝；凌晨答题有“夜猫子加成”。

</details>

## 协议

代码按 [MIT 协议](LICENSE) 开源。`site/study-img/nya-cry.jpg` 是网络上的表情包，版权归原作者，不在 MIT 协议范围内；自己用时建议换成自己的图。
