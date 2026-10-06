/* RiffLens node runner: engine vs independent python oracle (expected.json),
   plus buildToneWav -> analyze roundtrips. */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require(path.join(__dirname, '..', 'engine.js'));
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8'));

let checks = 0, fails = [];
function chk(c, m){ checks++; if (!c) fails.push(m); }
function close(a, b, tol, m){ chk(Math.abs(a - b) <= tol, m + ` (${a} vs ${b})`); }

for (const e of expected){
  const bytes = fs.readFileSync(path.join(__dirname, 'corpus', e.name + '.wav'));
  const a = R.analyze(new Uint8Array(bytes));
  chk(a.formType === e.formType, `${e.name}: formType`);
  chk(a.riffSize === e.riffSize, `${e.name}: riffSize`);
  chk(a.fileSize === e.fileSize, `${e.name}: fileSize`);
  chk(JSON.stringify(a.chunks) === JSON.stringify(e.chunks), `${e.name}: chunks ${JSON.stringify(a.chunks)} != ${JSON.stringify(e.chunks)}`);
  chk(a.fmt.tag === e.fmt.tag, `${e.name}: fmt.tag`);
  chk(a.fmt.channels === e.fmt.channels, `${e.name}: fmt.channels`);
  chk(a.fmt.rate === e.fmt.rate, `${e.name}: fmt.rate`);
  chk(a.fmt.byteRate === e.fmt.byteRate, `${e.name}: fmt.byteRate`);
  chk(a.fmt.blockAlign === e.fmt.blockAlign, `${e.name}: fmt.blockAlign`);
  chk(a.fmt.bits === e.fmt.bits, `${e.name}: fmt.bits`);
  chk(a.dataBytes === e.dataBytes, `${e.name}: dataBytes`);
  chk(a.frames === e.frames, `${e.name}: frames`);
  close(a.durationSec, e.durationSec, 1e-12, `${e.name}: durationSec`);
  chk(a.channels.length === e.channels.length, `${e.name}: channel count`);
  e.channels.forEach((ec, i) => {
    close(a.channels[i].peak, ec.peak, 1e-9, `${e.name} ch${i}: peak`);
    close(a.channels[i].dc, ec.dc, 1e-9, `${e.name} ch${i}: dc`);
    close(a.channels[i].rms, ec.rms, 1e-9, `${e.name} ch${i}: rms`);
    chk(a.channels[i].clipped === ec.clipped, `${e.name} ch${i}: clipped ${a.channels[i].clipped} != ${ec.clipped}`);
  });
  const hasSizeWarn = a.warnings.some(w => w.indexOf('RIFF size field') === 0);
  chk(hasSizeWarn === !!e.sizeMismatch, `${e.name}: size-mismatch warning (${a.warnings.join('; ')})`);
  if (e.info) chk(JSON.stringify(a.info) === JSON.stringify(e.info), `${e.name}: info ${JSON.stringify(a.info)} != ${JSON.stringify(e.info)}`);
  if (e.cuePoints !== undefined) chk(a.cuePoints === e.cuePoints, `${e.name}: cuePoints ${a.cuePoints} != ${e.cuePoints}`);
}

/* buildToneWav -> analyze roundtrips: synth parameters must survive through the bytes */
const trips = [
  {freq:440, seconds:1, rate:44100, bits:16, channels:1, type:'sine'},
  {freq:440, seconds:0.5, rate:22050, bits:8, channels:2, type:'sine'},
  {freq:220, seconds:0.25, rate:48000, bits:24, channels:1, type:'sweep'},
  {freq:440, seconds:0.4, rate:32000, bits:32, channels:2, type:'sine', float:true},
  {freq:110, seconds:0.5, rate:16000, bits:16, channels:1, type:'clip'},
  {freq:1, seconds:0.1, rate:8000, bits:16, channels:1, type:'noise'}
];
for (const t of trips){
  const w = R.buildToneWav(t);
  const a = R.analyze(w);
  const label = JSON.stringify(t);
  chk(a.fmt.channels === t.channels, `${label}: roundtrip channels`);
  chk(a.fmt.rate === t.rate, `${label}: roundtrip rate`);
  chk(a.fmt.bits === t.bits, `${label}: roundtrip bits`);
  chk(a.fmt.effectiveTag === (t.float ? 3 : 1), `${label}: roundtrip tag`);
  chk(a.frames === Math.floor(t.seconds * t.rate), `${label}: roundtrip frames`);
  close(a.durationSec, t.seconds, 1e-9, `${label}: roundtrip duration`);
  if (t.type === 'clip') chk(a.channels[0].clipped > 0, `${label}: clip detected`);
  if (t.type !== 'clip' && t.type !== 'noise') chk(a.channels[0].peak > 0.5 && a.channels[0].peak <= 1.0, `${label}: peak sane (${a.channels[0].peak})`);
  chk(a.warnings.length === 0, `${label}: no warnings (${a.warnings.join('; ')})`);
}

console.log(`${checks} checks, ${fails.length} failures`);
if (fails.length){ fails.forEach(f => console.log('FAIL', f)); process.exit(1); }
console.log('ALL PASS');
