#!/usr/bin/env python3
"""RiffLens oracle: independent python RIFF/WAVE parser (struct-based chunk
walker + sample decoding). Cross-checked against the wave module where the
module supports the format. Writes tests/expected.json."""
import json, struct, math, os, wave

CORPUS = ['sine16_mono','stereo8','tri24','float32','meta','clipped','silent','wrongsize']

def walk(b):
    chunks = []
    o = 12
    while o + 8 <= len(b):
        cid = b[o:o+4].decode('latin1')
        size = struct.unpack_from('<I', b, o+4)[0]
        do = o + 8
        if do + size > len(b):
            chunks.append(dict(id=cid, size=size, offset=o, truncated=True)); break
        chunks.append(dict(id=cid, size=size, offset=o, pad=size % 2 == 1))
        o = do + size + (size % 2)
    return chunks

def parse(name):
    b = open(f'tests/corpus/{name}.wav','rb').read()
    r = dict(name=name, fileSize=len(b))
    riff_size = struct.unpack_from('<I', b, 4)[0]
    r['riffSize'] = riff_size
    r['sizeMismatch'] = (riff_size + 8 != len(b))
    r['formType'] = b[8:12].decode()
    chunks = walk(b)
    r['chunks'] = [dict(id=c['id'], size=c['size'], offset=c['offset'], pad=c.get('pad',False), truncated=c.get('truncated',False)) for c in chunks]
    by_id = {c['id']: c for c in chunks}
    fc = by_id.get('fmt ')
    if fc:
        o = fc['offset'] + 8
        tag, ch, rate, brate, ba, bits = struct.unpack_from('<HHIIHH', b, o)
        r['fmt'] = dict(tag=tag, channels=ch, rate=rate, byteRate=brate, blockAlign=ba, bits=bits)
    dc = by_id.get('data')
    if fc and dc:
        o = dc['offset'] + 8; size = dc['size']
        f = r['fmt']; ba = f['blockAlign']
        frames = size // ba
        r['dataBytes'] = size; r['frames'] = frames
        r['durationSec'] = frames / f['rate']
        if f['tag'] in (1, 3):
            chs = [[] for _ in range(f['channels'])]
            bps = f['bits'] // 8
            for fr in range(frames):
                base = o + fr * ba
                for c in range(f['channels']):
                    p = base + c * bps
                    if f['tag'] == 1:
                        if f['bits'] == 8: s = (b[p] - 128) / 128
                        elif f['bits'] == 16: s = struct.unpack_from('<h', b, p)[0] / 32768
                        elif f['bits'] == 24:
                            x = b[p] | (b[p+1] << 8) | (b[p+2] << 16)
                            if x >= 0x800000: x -= 0x1000000
                            s = x / 8388608
                        elif f['bits'] == 32: s = struct.unpack_from('<i', b, p)[0] / 2147483648
                    else:
                        if f['bits'] == 32: s = struct.unpack_from('<f', b, p)[0]
                        elif f['bits'] == 64: s = struct.unpack_from('<d', b, p)[0]
                    chs[c].append(s)
            r['channels'] = []
            for samples in chs:
                n = len(samples)
                peak = max(abs(s) for s in samples)
                dc_off = sum(samples) / n
                rms = math.sqrt(sum(s*s for s in samples) / n)
                clipped = sum(1 for s in samples if abs(s) >= 0.9999)
                r['channels'].append(dict(peak=peak, dc=dc_off, rms=rms, clipped=clipped))
    lc = by_id.get('LIST')
    if lc:
        o = lc['offset'] + 8; end = o + lc['size']
        info = {}
        if b[o:o+4] == b'INFO':
            p = o + 4
            while p + 8 <= end:
                k = b[p:p+4].decode('latin1')
                sz = struct.unpack_from('<I', b, p+4)[0]
                raw = b[p+8:p+8+sz]
                info[k] = raw.split(b'\x00')[0].decode('latin1')
                p += 8 + sz + (sz % 2)
        r['info'] = info
    cc = by_id.get('cue ')
    if cc:
        r['cuePoints'] = struct.unpack_from('<I', b, cc['offset']+8)[0]
    return r

out = [parse(n) for n in CORPUS]
json.dump(out, open('tests/expected.json','w'))
print(len(out), 'entries')
for e in out:
    f = e.get('fmt', {})
    chs = e.get('channels', [])
    print(e['name'], f.get('tagName',f.get('tag')), f.get('channels'), 'ch', f.get('bits'), 'bit', f.get('rate'), 'Hz',
          'dur', round(e.get('durationSec',0),4), 'chunks', [c['id'] for c in e['chunks']],
          'peak', round(chs[0]['peak'],5) if chs else '-')
# wave-module cross-check for the PCM files it can read
for n in ['sine16_mono','stereo8','tri24','clipped','silent','wrongsize']:
    w = wave.open(f'tests/corpus/{n}.wav')
    e = next(x for x in out if x['name']==n)
    assert w.getnchannels()==e['fmt']['channels'] and w.getframerate()==e['fmt']['rate'] and w.getnframes()==e['frames'], n
    print('wave-module x-check OK:', n)
