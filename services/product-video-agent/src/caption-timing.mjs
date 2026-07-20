import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { WordTimingSchema } from './schemas.mjs';

function formatAssTime(seconds) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`;
}

function escapeAssText(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll('\n', ' ')
    .trim();
}

function groupWords(words, maxWordsPerLine) {
  const groups = [];
  for (let index = 0; index < words.length; index += maxWordsPerLine) {
    groups.push(words.slice(index, index + maxWordsPerLine));
  }
  return groups;
}

export function buildAssCaptions(rawWords, options = {}) {
  const words = rawWords.map((word) => WordTimingSchema.parse(word));
  const maxWordsPerLine = options.maxWordsPerLine || 5;
  const fontName = options.fontName || 'Avenir Next';
  const fontSize = options.fontSize || 74;
  const marginV = options.marginV || 360;
  const events = groupWords(words, maxWordsPerLine).map((group) => {
    const start = group[0].start;
    const end = Math.max(group.at(-1).end, start + 0.1);
    const text = group.map((word) => {
      const duration = Math.max(1, Math.round((word.end - word.start) * 100));
      return `{\\k${duration}}${escapeAssText(word.word)}`;
    }).join(' ');
    return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`;
  });

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H0000A5FF,&H00101920,&H80000000,-1,0,0,0,100,100,0,0,1,6,1,2,120,120,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

export async function writeCaptionArtifacts({ words, wordsPath, assPath, options }) {
  await Promise.all([mkdir(dirname(wordsPath), { recursive: true }), mkdir(dirname(assPath), { recursive: true })]);
  await Promise.all([
    writeFile(wordsPath, `${JSON.stringify(words, null, 2)}\n`, 'utf8'),
    writeFile(assPath, buildAssCaptions(words, options), 'utf8'),
  ]);
}
