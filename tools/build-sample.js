#!/usr/bin/env node
/*
 * 示例题库生成脚本：node tools/build-sample.js
 * 把下面 SUBJECTS 里写的内容转成网页要用的 site/study-data/*.json。
 * 换成自己的题库：照着示例的格式改 SUBJECTS，再运行一次。题目全是示例，内容很简单，只为演示功能。
 *
 * 字段说明（网页 study.js 读这些字段）：
 *   科目：slug（英文网址名）、name、term（页头小字）、intro（考点卡说明，HTML）、chapters、hot（高频页，HTML）、quiz、subjective、exam
 *   章节：{ id:"01", title, stars:0-3, cards:[ { no:"1-1", title, stars, html, refs:[题号…] } ] }
 *   选择题：{ id, src（来源）, st（ok 有依据 / q 未核实 / warn 看条件 / stop 不计分）, stem, opts:[…], ans（正确选项下标，stop 时为 -1）, ch（章号）, card（卡片编号）, ex（解析）, note? }
 *   主观题：subjective.groups[].items[] = { id, title, html }，id 为空的条目不能标“背会了”
 *   模拟卷：exam = { title, minutes, intro, parts:[ { title, score（每题分值，主观题为 null）, qs:[ { n, stem, opts, ans, ex, src } ] } ], tip }
 *           主观题 opts 为空数组，用 ref（参考答案标题）+ ex（参考答案）；src 里可以放 <button class="link" data-subj="S-01">去背诵栏看 S-01</button>
 *   “整理中”的科目：在 PENDING 里写 { slug, name, note }，首页显示 note，点开出哭哭图。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'site', 'study-data');

const b = s => `<b>${s}</b>`;
const ul = items => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
const subjBtn = id => `<button type="button" class="link" data-subj="${id}">去背诵栏看 ${id}</button>`;

const SUBJECTS = [
  {
    slug: 'shengli', name: '示例·生理学', term: '期末复习（示例）', dot: '生',
    intro: `<p>考点卡按章整理，${b('★★★')} 是必背、★★ 应会、★ 有空再看。每张卡底下的“对应题”可以直接点去做题。</p>`,
    chapters: [
      { id: '01', title: '细胞的基本功能', stars: 3, intro: '<p>静息电位和动作电位每年必考。</p>', cards: [
        { no: '1-1', title: '静息电位', stars: 3, html: ul([`形成主要靠 ${b('K⁺ 外流')}，接近 K⁺ 平衡电位。`, '细胞外 K⁺ 浓度升高 → 静息电位绝对值减小。']), refs: ['SL-01', 'SL-02'] },
        { no: '1-2', title: '动作电位', stars: 3, html: ul([`上升支：${b('Na⁺ 内流')}；下降支：K⁺ 外流。`, `特点：${b('“全或无”')}、不衰减传导。`, '<div class="flag f-warn"><em>易错</em><div>阈刺激决定能不能产生动作电位，不决定动作电位的大小。</div></div>']), refs: ['SL-03', 'SL-04'] },
        { no: '1-3', title: '物质跨膜转运', stars: 2, html: ul(['单纯扩散：O₂、CO₂ 等脂溶性小分子。', `易化扩散：经通道或载体，${b('顺浓度差')}，不耗能。`, `主动转运：${b('逆浓度差')}，耗能，例如钠钾泵。`]), refs: ['SL-05'] },
      ] },
      { id: '02', title: '血液', stars: 2, intro: '', cards: [
        { no: '2-1', title: '血细胞正常值', stars: 2, html: ul(['红细胞：男 4.0–5.5 × 10¹²/L，女 3.5–5.0 × 10¹²/L。', '白细胞：4.0–10.0 × 10⁹/L。', '血小板：100–300 × 10⁹/L。']), refs: ['SL-06'] },
        { no: '2-2', title: 'ABO 血型', stars: 3, html: ul([`按红细胞膜上的 ${b('A、B 抗原')}分型。`, 'O 型红细胞上没有 A、B 抗原，血清中有抗 A、抗 B 抗体。']), refs: ['SL-07', 'SL-08'] },
      ] },
      { id: '03', title: '血液循环', stars: 3, intro: '', cards: [
        { no: '3-1', title: '心动周期', stars: 2, html: ul(['心率加快时，舒张期缩短得比收缩期多。', `房室瓣关闭 → ${b('第一心音')}；动脉瓣关闭 → 第二心音。`]), refs: ['SL-09'] },
        { no: '3-2', title: '影响动脉血压的因素', stars: 3, html: ul([`每搏输出量主要影响 ${b('收缩压')}。`, `外周阻力主要影响 ${b('舒张压')}。`, '大动脉弹性下降 → 脉压增大。']), refs: ['SL-10', 'SL-11', 'SL-12'] },
      ] },
    ],
    hot: `<div class="note"><p>示例高频页：题号、卡片编号、章号都能点。</p></div>
      <h2>一、章节热度</h2>
      <div class="tbl"><table><thead><tr><th>章</th><th>内容</th><th class="r">出现次数</th><th>卡片</th></tr></thead><tbody>
      <tr><td>01</td><td>细胞的基本功能</td><td class="r">6</td><td>1-1、1-2</td></tr>
      <tr><td>02</td><td>血液</td><td class="r">3</td><td>2-2</td></tr>
      <tr><td>03</td><td>血液循环</td><td class="r">5</td><td>3-2</td></tr></tbody></table></div>
      <h2>二、高频考点速记</h2>
      <ul><li>SL-01 静息电位主要由什么形成 → ${b('K⁺ 外流')}</li><li>SL-03 动作电位上升支 → ${b('Na⁺ 内流')}</li><li>SL-10 每搏输出量增加主要升高 → ${b('收缩压')}</li></ul>
      <h2>三、主观题</h2><ul><li>S-01 静息电位和动作电位的形成机制</li><li>S-02 影响动脉血压的因素</li></ul>`,
    quiz: [
      ['SL-01', 'ok', '静息电位的形成主要是由于', ['Na⁺ 内流', 'K⁺ 外流', 'Ca²⁺ 内流', 'Cl⁻ 内流', 'K⁺ 内流'], 1, '01', '1-1', '静息电位主要由 K⁺ 外流形成'],
      ['SL-02', 'ok', '细胞外 K⁺ 浓度升高时，静息电位的绝对值', ['增大', '减小', '不变', '先增大后减小', '先减小后增大'], 1, '01', '1-1', '细胞外 K⁺ 升高 → K⁺ 外流减少 → 静息电位绝对值减小'],
      ['SL-03', 'ok', '神经细胞动作电位上升支主要是由于', ['K⁺ 外流', 'Na⁺ 内流', 'Ca²⁺ 内流', 'Cl⁻ 内流', 'Na⁺ 外流'], 1, '01', '1-2', '上升支（去极化）由 Na⁺ 快速内流形成'],
      ['SL-04', 'warn', '关于动作电位的说法，正确的是', ['刺激越强，动作电位越大', '具有“全或无”的特点', '传导时幅度逐渐减小', '只能单向传导', '不需要达到阈电位'], 1, '01', '1-2', '动作电位“全或无”，不衰减传导', '示例：这道题演示“看条件”标签'],
      ['SL-05', 'ok', '葡萄糖进入红细胞的方式是', ['单纯扩散', '经载体易化扩散', '原发性主动转运', '继发性主动转运', '入胞'], 1, '01', '1-3', '葡萄糖进入红细胞：经载体的易化扩散'],
      ['SL-06', 'q', '成年男性红细胞的正常值约为', ['(2.0–3.0) × 10¹²/L', '(4.0–5.5) × 10¹²/L', '(6.0–7.0) × 10¹²/L', '(4.0–10.0) × 10⁹/L', '(100–300) × 10⁹/L'], 1, '02', '2-1', '男性红细胞 (4.0–5.5) × 10¹²/L'],
      ['SL-07', 'ok', 'ABO 血型的分型依据是', ['血清中的抗体', '红细胞膜上的抗原', '白细胞膜上的抗原', '血小板数量', 'Rh 因子'], 1, '02', '2-2', '按红细胞膜上 A、B 抗原分型'],
      ['SL-08', 'stop', '某人血清中只有抗 B 抗体，他的血型是（示例：缺选项的题）', ['A 型', 'B 型', '', '', ''], -1, '02', '2-2', '血清中只有抗 B → 红细胞上有 A 抗原 → A 型', '这道题演示“不计分”：原题缺选项'],
      ['SL-09', 'ok', '第一心音的产生主要是由于', ['动脉瓣关闭', '房室瓣关闭', '心房收缩', '血液冲击动脉壁', '心室舒张'], 1, '03', '3-1', '房室瓣关闭 → 第一心音'],
      ['SL-10', 'ok', '每搏输出量增加时，主要升高的是', ['收缩压', '舒张压', '平均动脉压', '中心静脉压', '脉搏'], 0, '03', '3-2', '每搏输出量主要影响收缩压'],
      ['SL-11', 'ok', '外周阻力增大时，主要升高的是', ['收缩压', '舒张压', '脉压', '中心静脉压', '心率'], 1, '03', '3-2', '外周阻力主要影响舒张压'],
      ['SL-12', 'q', '老年人大动脉弹性下降时，血压的变化是', ['收缩压降低，舒张压升高', '收缩压升高，脉压增大', '收缩压和舒张压都降低', '脉压减小', '血压不变'], 1, '03', '3-2', '大动脉弹性下降 → 收缩压升高、脉压增大'],
    ],
    subjective: { intro: '<p>先自己说一遍，再点开对照。</p>', groups: [
      { title: '简答题', note: '', items: [
        { id: 'S-01', title: '简述静息电位和动作电位的形成机制', html: ul(['静息电位：主要由 K⁺ 外流形成。', '动作电位上升支：Na⁺ 内流；下降支：K⁺ 外流。', '钠钾泵维持细胞内外离子浓度差。']) },
        { id: 'S-02', title: '影响动脉血压的因素有哪些？', html: ul(['每搏输出量（主要影响收缩压）。', '心率。', '外周阻力（主要影响舒张压）。', '大动脉弹性。', '循环血量与血管容量的比例。']) },
      ] },
      { title: '说明', note: '<p>这一条没有题号，演示“不能标背会了”的条目。</p>', items: [
        { id: '', title: '答题小技巧', html: '<p>先写结论，再分点写原因。</p>' },
      ] },
    ] },
    exam: {
      title: '示例·生理学自主测试', minutes: 20,
      intro: '<div class="note"><p>示例卷：单选 5 题，每题 2 分；简答 1 题。</p></div>',
      parts: [
        { title: '单项选择题（每题 2 分）', score: 2, qs: [
          { n: 1, stem: '静息电位的形成主要是由于', opts: ['Na⁺ 内流', 'K⁺ 外流', 'Ca²⁺ 内流', 'Cl⁻ 内流', 'K⁺ 内流'], ans: 1, ex: '静息电位主要由 K⁺ 外流形成', src: '来源：SL-01 · 考点卡 1-1' },
          { n: 2, stem: '动作电位上升支主要是由于', opts: ['K⁺ 外流', 'Na⁺ 内流', 'Ca²⁺ 内流', 'Cl⁻ 内流', 'Na⁺ 外流'], ans: 1, ex: '上升支由 Na⁺ 内流形成', src: '来源：SL-03 · 考点卡 1-2' },
          { n: 3, stem: 'ABO 血型的分型依据是', opts: ['血清中的抗体', '红细胞膜上的抗原', '白细胞膜上的抗原', '血小板数量', 'Rh 因子'], ans: 1, ex: '按红细胞膜上 A、B 抗原分型', src: '来源：SL-07 · 考点卡 2-2' },
          { n: 4, stem: '外周阻力增大时，主要升高的是', opts: ['收缩压', '舒张压', '脉压', '中心静脉压', '心率'], ans: 1, ex: '外周阻力主要影响舒张压', src: '来源：SL-11 · 考点卡 3-2' },
          { n: 5, stem: '第一心音的产生主要是由于', opts: ['动脉瓣关闭', '房室瓣关闭', '心房收缩', '血液冲击动脉壁', '心室舒张'], ans: 1, ex: '房室瓣关闭产生第一心音', src: '来源：SL-09 · 考点卡 3-1' },
        ] },
        { title: '简答题', score: null, qs: [
          { n: 6, stem: '简述影响动脉血压的因素。', opts: [], ref: '影响动脉血压的因素', ex: '每搏输出量、心率、外周阻力、大动脉弹性、循环血量与血管容量的比例。', src: `来源：示例 · ${subjBtn('S-02')}` },
        ] },
      ],
      tip: '<p>做完后回到「考点」栏看错题对应的卡片，主观题对照「背诵」栏的要点。</p>',
    },
  },
  {
    slug: 'jisuanji', name: '示例·计算机基础', term: '期末复习（示例）', dot: '计',
    intro: '<p>第二个示例科目，内容更少，用来演示多科切换。</p>',
    chapters: [
      { id: '01', title: '数制与编码', stars: 3, intro: '', cards: [
        { no: '1-1', title: '进制转换', stars: 3, html: ul([`二进制 ${b('1010')} = 十进制 10。`, '十六进制 F = 十进制 15。']), refs: ['JS-01', 'JS-02'] },
        { no: '1-2', title: '存储单位', stars: 2, html: ul([`1 字节（Byte）= ${b('8 位（bit）')}。`, '1 KB = 1024 Byte。']), refs: ['JS-03'] },
      ] },
      { id: '02', title: '计算机网络', stars: 2, intro: '', cards: [
        { no: '2-1', title: '常见协议', stars: 2, html: ul([`网页：${b('HTTP / HTTPS')}。`, '域名解析：DNS。']), refs: ['JS-04', 'JS-05'] },
      ] },
    ],
    hot: `<h2>高频考点</h2><ul><li>JS-01 二进制 1010 等于十进制 → ${b('10')}</li><li>JS-03 1 字节等于 → ${b('8 位')}</li><li>JS-04 把域名转换成 IP 地址的是 → ${b('DNS')}</li></ul>`,
    quiz: [
      ['JS-01', 'ok', '二进制数 1010 等于十进制的', ['8', '10', '12', '5', '20'], 1, '01', '1-1', '1010₂ = 8 + 2 = 10'],
      ['JS-02', 'ok', '十六进制数 F 等于十进制的', ['10', '14', '15', '16', '17'], 2, '01', '1-1', 'F = 15'],
      ['JS-03', 'ok', '1 个字节等于', ['4 位', '8 位', '16 位', '32 位', '1024 位'], 1, '01', '1-2', '1 Byte = 8 bit'],
      ['JS-04', 'ok', '把域名转换成 IP 地址的是', ['HTTP', 'FTP', 'DNS', 'SMTP', 'TCP'], 2, '02', '2-1', 'DNS 负责域名解析'],
      ['JS-05', 'q', '浏览网页时地址栏里带小锁的一般是', ['HTTP', 'HTTPS', 'FTP', 'POP3', 'Telnet'], 1, '02', '2-1', 'HTTPS 是加密的 HTTP'],
    ],
    subjective: { intro: '', groups: [
      { title: '简答题', note: '', items: [
        { id: 'S-01', title: '简述二进制转十进制的方法', html: '<p>按权展开相加：每一位乘以 2 的相应次方，再把结果加起来。</p>' },
      ] },
    ] },
    exam: {
      title: '示例·计算机基础自主测试', minutes: 10,
      intro: '<div class="note"><p>示例卷：单选 3 题。</p></div>',
      parts: [
        { title: '单项选择题（每题 1 分）', score: 1, qs: [
          { n: 1, stem: '二进制数 1010 等于十进制的', opts: ['8', '10', '12', '5', '20'], ans: 1, ex: '1010₂ = 10', src: '来源：JS-01' },
          { n: 2, stem: '1 个字节等于', opts: ['4 位', '8 位', '16 位', '32 位', '1024 位'], ans: 1, ex: '1 Byte = 8 bit', src: '来源：JS-03' },
          { n: 3, stem: '把域名转换成 IP 地址的是', opts: ['HTTP', 'FTP', 'DNS', 'SMTP', 'TCP'], ans: 2, ex: 'DNS 负责域名解析', src: '来源：JS-04' },
        ] },
      ],
      tip: '',
    },
  },
];
const PENDING = [
  { slug: 'daizhengli', name: '示例·还没整理的科目', dot: '待', note: '没买书没找到电子版也没找到资料喵，等着吧喵' },
];

fs.mkdirSync(OUT, { recursive: true });
const index = { built: new Date().toISOString().slice(0, 10), subjects: [] };
for (const S of SUBJECTS) {
  const quiz = S.quiz.map(([id, st, stem, opts, ans, ch, card, ex, note]) => ({ id, src: '示例题', st, stem, opts, ans, ch, card, ex, ...(note ? { note } : {}) }));
  for (const q of quiz) if (q.st !== 'stop' && !(q.ans >= 0 && q.opts[q.ans])) throw new Error(`${S.name} ${q.id} 的答案指向不存在的选项`);
  const data = { slug: S.slug, name: S.name, term: S.term, intro: S.intro, chapters: S.chapters.map(c => ({ appendix: false, ...c })), hot: S.hot, subjective: S.subjective, quiz, exam: S.exam };
  const json = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT, `${S.slug}.json`), json);
  index.subjects.push({ slug: S.slug, name: S.name, ...(S.dot ? { dot: S.dot } : {}), cards: S.chapters.reduce((n, c) => n + c.cards.length, 0), quiz: quiz.length, scored: quiz.filter(q => q.st !== 'stop').length, subjective: S.subjective.groups.reduce((n, g) => n + g.items.length, 0), chapters: S.chapters.length, size: Buffer.byteLength(json) });
  console.log(`${S.name}：考点卡 ${index.subjects.at(-1).cards} 张，选择题 ${quiz.length} 道`);
}
for (const p of PENDING) index.subjects.push({ ...p, pending: true });
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log('已写入 site/study-data/');
