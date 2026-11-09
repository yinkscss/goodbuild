// Build a voice-over track from a script.json: node vo.cjs <dir containing vo/script.json> <music.wav> <video.mp4> <out.mp4>
// Uses macOS `say` (offline). Lines are cued at their `t` seconds; overlaps and overruns are reported. Music is ducked under the voice.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const [dir, music, video, out] = process.argv.slice(2).map(p => path.resolve(p));
const S = JSON.parse(fs.readFileSync(path.join(dir, 'vo/script.json'), 'utf8'));
const work = path.join(dir, 'vo/.lines'); fs.mkdirSync(work, { recursive: true });
const dur = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString();
const inputs = [], delays = []; let prevEnd = 0, bad = 0;
S.lines.forEach((L, i) => {
  const aiff = path.join(work, `l${i}.aiff`), wav = path.join(work, `l${i}.wav`);
  const tag = `${S.voice}|${S.rate}|${L.text}`, tf = wav + '.txt';
  if (!(fs.existsSync(wav) && fs.existsSync(tf) && fs.readFileSync(tf, 'utf8') === tag)) {
  execFileSync('say', ['-v', S.voice, '-r', String(S.rate), '-o', aiff, L.text]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ar', '44100', '-ac', '1', wav]); fs.writeFileSync(tf, tag); }
  const d = dur(wav), end = L.t + d; const flag = (L.t < prevEnd + .12 ? ' OVERLAP' : '') + (end > S.total - .3 ? ' OVERRUN' : ''); if (flag) bad++;
  console.log(`${L.t.toFixed(2).padStart(6)} - ${end.toFixed(2).padStart(6)}  ${L.text}${flag}`); prevEnd = end;
  inputs.push('-i', wav); delays.push(`[${i + 1}]adelay=${Math.round(L.t * 1000)}|${Math.round(L.t * 1000)}[v${i}]`);
});
const vo = path.join(dir, 'vo/voiceover.wav');
const mixIn = S.lines.map((_, i) => `[v${i}]`).join('');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', music, ...inputs, '-filter_complex',
  `${delays.join(';')};${mixIn}amix=inputs=${S.lines.length}:normalize=0,acompressor=threshold=-20dB:ratio=3:makeup=4,alimiter=limit=0.9,apad=whole_dur=${S.total},atrim=0:${S.total},asplit=2[vo][vk];[0]aformat=channel_layouts=stereo[m];[m][vk]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=250:makeup=1[md];[vo]pan=stereo|c0=c0|c1=c0[vs];[md][vs]amix=inputs=2:normalize=0,alimiter=limit=0.92,loudnorm=I=-16:TP=-2:LRA=7,atrim=0:${S.total}[mix]`,
  '-map', '[mix]', '-ar', '44100', path.join(dir, 'vo/mix.wav')]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', path.join(dir, 'vo/mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out]);
console.log(bad ? `${bad} timing flag(s)` : 'timing ok', '->', out);
