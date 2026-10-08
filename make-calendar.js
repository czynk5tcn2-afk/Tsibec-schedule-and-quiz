// 生成课程表的日历订阅文件 site/calendar.ics（小克版 r10 起）
//
// 用法（在 schedule 文件夹里运行）：
//   node make-calendar.js          重新生成 site/calendar.ics
//   node make-calendar.js --check  只检查是否和 index.html 的数据一致，不一致返回非 0（发版前用）
//
// 数据全部从 site/index.html 里读：SEMESTER、CLASS_TIMES、COURSES、EXAMS。
// 改了课程、作息或考试，都要重新运行一次再部署。
// 输出是确定的（同样的数据生成同样的文件），所以 --check 可以逐字节比较。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SITE = path.join(__dirname, "site");
const OUT = path.join(SITE, "calendar.ics");
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

function grab(name) {
  const m = html.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n`));
  if (!m) throw new Error(`index.html 里找不到 ${name}`);
  return vm.runInNewContext(`(${m[1]})`);
}
const SEMESTER = grab("SEMESTER");
const CLASS_TIMES = grab("CLASS_TIMES");
const COURSES = grab("COURSES");
const EXAMS = grab("EXAMS");

// 和 index.html 的 active() 同一套规则："1-5"、"6-8(双),9-10"
function active(spec, week) {
  return spec.split(",").some(raw => {
    const m = raw.trim().match(/^(\d+)(?:-(\d+))?(?:\((单|双)\))?$/);
    if (!m) return false;
    const a = +m[1], b = +(m[2] || m[1]);
    return week >= a && week <= b && (!m[3] || (m[3] === "单" ? week % 2 === 1 : week % 2 === 0));
  });
}

// 北京时间 → UTC 时间戳字符串（北京没有夏令时，固定 +8）
function utcStamp(y, mo, d, hhmm) {
  const [h, mi] = hhmm.split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h - 8, mi));
  const p = n => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}00Z`;
}
function dateParts(base, addDays) {
  const t = new Date(Date.UTC(...base.split("-").map((v, i) => i === 1 ? v - 1 : +v)) + addDays * 86400000);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
const esc = text => String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// 每行最多 75 字节，超出折行（按 UTF-8 字节数，不把汉字切开）
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
// 稳定的 UID：同一节课每次生成都一样，日历更新时能对上
function uid(key) {
  let h = 2166136261;
  for (const ch of Buffer.from(key)) { h ^= ch; h = Math.imul(h, 16777619) >>> 0; }
  return `${h.toString(16).padStart(8, "0")}-${Buffer.byteLength(key)}@schedule.example`;
}

const STAMP = utcStamp(...dateParts(SEMESTER.firstWeekStartDate, 0), "08:00");
const events = [];
const seen = new Set();
for (let week = 1; week <= SEMESTER.totalWeeks; week++) {
  for (const c of COURSES) {
    if (!active(c[5], week)) continue;
    const [name, place, day, start, end] = c;
    const [y, mo, d] = dateParts(SEMESTER.firstWeekStartDate, (week - 1) * 7 + day - 1);
    const key = `${name}|${y}-${mo}-${d}|${start}|${end}|${place}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lunch = start <= 4 && end >= 5 ? `，中午 ${CLASS_TIMES[3][1]}–${CLASS_TIMES[4][0]} 休息` : "";
    events.push({
      sort: utcStamp(y, mo, d, CLASS_TIMES[start - 1][0]) + name,
      lines: [
        `UID:${uid(key)}`,
        `DTSTAMP:${STAMP}`,
        `DTSTART:${utcStamp(y, mo, d, CLASS_TIMES[start - 1][0])}`,
        `DTEND:${utcStamp(y, mo, d, CLASS_TIMES[end - 1][1])}`,
        `SUMMARY:${esc(name)}`,
        `LOCATION:${esc(place)}`,
        `DESCRIPTION:${esc(`第${start}–${end}节 · 第${week}周${lunch}`)}`,
        "TRANSP:OPAQUE",
      ],
    });
  }
}
for (const exam of EXAMS) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exam.date || "")) continue;
  const [y, mo, d] = exam.date.split("-").map(Number);
  const times = String(exam.time || "").match(/(\d{1,2}:\d{2})\s*[-—–~至到]+\s*(\d{1,2}:\d{2})/);
  const key = `考试|${exam.course}|${exam.date}`;
  const p = n => String(n).padStart(2, "0");
  const next = dateParts(exam.date, 1);
  events.push({
    sort: (times ? utcStamp(y, mo, d, times[1]) : `${y}${p(mo)}${p(d)}`) + exam.course,
    lines: [
      `UID:${uid(key)}`,
      `DTSTAMP:${STAMP}`,
      ...(times
        ? [`DTSTART:${utcStamp(y, mo, d, times[1])}`, `DTEND:${utcStamp(y, mo, d, times[2])}`]
        : [`DTSTART;VALUE=DATE:${y}${p(mo)}${p(d)}`, `DTEND;VALUE=DATE:${next[0]}${p(next[1])}${p(next[2])}`]),
      `SUMMARY:${esc(`考试：${exam.course}`)}`,
      ...(exam.place ? [`LOCATION:${esc(exam.place)}`] : []),
      ...(exam.note || !times ? [`DESCRIPTION:${esc([exam.note, times ? "" : `时间：${exam.time || "待定"}`].filter(Boolean).join("；"))}`] : []),
    ],
  });
}
events.sort((a, b) => a.sort.localeCompare(b.sort));

const lines = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//dopamine-schedule//schedule//ZH",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:课程表",
  "X-WR-TIMEZONE:Asia/Shanghai",
  "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  "X-PUBLISHED-TTL:PT6H",
  ...events.flatMap(e => ["BEGIN:VEVENT", ...e.lines, "END:VEVENT"]),
  "END:VCALENDAR",
];
const ics = lines.map(fold).join("\r\n") + "\r\n";

if (process.argv.includes("--check")) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (old !== ics) {
    console.error("calendar.ics 和 index.html 的数据不一致：请先运行 node make-calendar.js");
    process.exit(1);
  }
  console.log(`calendar.ics 是最新的（${events.length} 个日程）`);
} else {
  fs.writeFileSync(OUT, ics);
  console.log(`已生成 site/calendar.ics：${events.length} 个日程（课 ${seen.size}，考试 ${events.length - seen.size}）`);
}
