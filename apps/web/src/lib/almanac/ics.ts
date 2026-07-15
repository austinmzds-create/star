/**
 * 零依赖 .ics（RFC 5545）生成器：天象事件 →「添加到日历」下载。
 *
 * 要点：
 * - 行结束 \r\n；UID 复用事件 id（重复导入同事件时日历软件自动覆盖）。
 * - 文本转义（\\ ; , 换行）+ 超 75 字节折行（次行前置空格；按 UTF-8
 *   字节数在字符边界保守切 60 字节，避免拆断多字节汉字）。
 * - 每个 VEVENT 附 -1h DISPLAY 提醒（VALARM）。
 */

export interface IcsEvent {
  /** 稳定事件 id（→ UID:<id>@star-almanac）。 */
  id: string;
  /** 事件开始时刻（UTC epoch ms）。 */
  startMs: number;
  /** 时长（分钟，默认 60）；allDay 事件忽略。 */
  durationMin?: number;
  summary: string;
  description?: string;
  /** 全天事件（DTSTART;VALUE=DATE，单日）。 */
  allDay?: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC epoch ms → ics UTC 时刻格式 yyyyMMddTHHmmssZ。 */
function icsDateTimeUtc(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** UTC epoch ms → ics 日期格式 yyyyMMdd。 */
function icsDateUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** RFC 5545 文本转义：反斜杠、分号、逗号与换行。 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

/** 超 75 字节的行按 RFC 5545 折行（保守 60 字节/段，字符边界切割）。 */
function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const segments: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > 60) {
      segments.push(current);
      current = ch;
      currentBytes = chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current) segments.push(current);
  return segments.map((s, i) => (i === 0 ? s : ` ${s}`)).join('\r\n');
}

/** 生成完整 VCALENDAR 文本（一个日历装入全部传入事件）。 */
export function buildIcs(events: IcsEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//星辰纪念//almanac//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const stamp = icsDateTimeUtc(Date.now());
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@star-almanac`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDateUtc(ev.startMs)}`);
    } else {
      lines.push(`DTSTART:${icsDateTimeUtc(ev.startMs)}`);
      lines.push(`DTEND:${icsDateTimeUtc(ev.startMs + (ev.durationMin ?? 60) * 60_000)}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${escapeText(ev.summary)}`);
    lines.push('TRIGGER:-PT1H');
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** 生成并触发浏览器下载（Blob + a[download]）。 */
export function downloadIcs(filename: string, events: IcsEvent[]): void {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
