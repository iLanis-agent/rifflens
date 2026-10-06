#!/usr/bin/env python3
"""Generate the WAV corpus with python's wave module + struct for odd cases."""
import wave, struct, math, os

OUT = 'tests/corpus'
os.makedirs(OUT, exist_ok=True)

def sine16_mono():
    w = wave.open(f'{OUT}/sine16_mono.wav', 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
    frames = b''.join(struct.pack('<h', round(0.8*32767*math.sin(2*math.pi*440*i/44100))) for i in range(44100))
    w.writeframes(frames); w.close()

def stereo8():
    w = wave.open(f'{OUT}/stereo8.wav', 'wb')
    w.setnchannels(2); w.setsampwidth(1); w.setframerate(22050)
    frames = b''.join(bytes([
        round(127.5 + 127*0.6*math.sin(2*math.pi*440*i/22050)),
        round(127.5 + 127*0.4*math.sin(2*math.pi*660*i/22050))]) for i in range(11025))
    w.writeframes(frames); w.close()

def tri24():
    w = wave.open(f'{OUT}/tri24.wav', 'wb')
    w.setnchannels(1); w.setsampwidth(3); w.setframerate(48000)
    def tri(t): return 2*abs(2*(t*330 % 1) - 1) - 1
    frames = b''.join((lambda x: x.to_bytes(3,'little',signed=True))(round(0.7*8388607*tri(i/48000))) for i in range(12000))
    w.writeframes(frames); w.close()

def float32stereo():
    # wave module doesn't do float; write RIFF manually with tag 3
    rate, frames_n = 32000, 12800
    ba = 2*4; data = bytearray()
    for i in range(frames_n):
        data += struct.pack('<f', 0.5*math.sin(2*math.pi*440*i/rate))
        data += struct.pack('<f', 0.25*math.sin(2*math.pi*880*i/rate))
    riff = b'RIFF' + struct.pack('<I', 4 + 24 + 8 + len(data)) + b'WAVE'
    fmt = b'fmt ' + struct.pack('<IHHIIHH', 16, 3, 2, rate, rate*ba, ba, 32)
    hdr = riff + fmt + b'data' + struct.pack('<I', len(data))
    open(f'{OUT}/float32.wav','wb').write(hdr + data)

def meta():
    # 16-bit mono + LIST INFO + odd-sized unknown chunk + cue, manual RIFF
    rate, frames_n = 8000, 4000
    pcm = b''.join(struct.pack('<h', round(0.5*32767*math.sin(2*math.pi*440*i/rate))) for i in range(frames_n))
    fmt = b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate*2, 2, 16)
    def zstr(s):
        b = s.encode() + b'\x00'
        return b + (b'\x00' if len(b) % 2 else b'')
    info_body = b'INFO'
    for k, v in [(b'INAM', 'RiffLens test tone'), (b'IART', 'app factory'), (b'ICMT', 'odd lengths on purpose')]:
        info_body += k + struct.pack('<I', len(v)+1) + zstr(v)
    listc = b'LIST' + struct.pack('<I', len(info_body)) + info_body
    odd = b'abcd' + struct.pack('<I', 3) + b'XYZ' + b'\x00'  # odd size + pad
    cue_body = struct.pack('<I', 1) + struct.pack('<II4sIII', 1, 100, b'data', 0, 0, 100)
    cuec = b'cue ' + struct.pack('<I', len(cue_body)) + cue_body
    datac = b'data' + struct.pack('<I', len(pcm)) + pcm
    riff_size = 4 + len(fmt) + len(listc) + len(odd) + len(cuec) + len(datac)
    open(f'{OUT}/meta.wav','wb').write(b'RIFF' + struct.pack('<I', riff_size) + b'WAVE' + fmt + listc + odd + cuec + datac)

def clipped():
    w = wave.open(f'{OUT}/clipped.wav', 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    frames = b''.join(struct.pack('<h', max(-32768, min(32767, round(2.5*32767*math.sin(2*math.pi*220*i/16000))))) for i in range(8000))
    w.writeframes(frames); w.close()

def silent():
    w = wave.open(f'{OUT}/silent.wav', 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
    w.writeframes(b'\x00\x00' * 8000); w.close()

def wrongsize():
    # RIFF size field lies: says 4 bytes more than actual
    w = wave.open(f'{OUT}/wrongsize.wav', 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b'\x01\x00' * 1000); w.close()
    p = f'{OUT}/wrongsize.wav'
    b = bytearray(open(p,'rb').read())
    struct.pack_into('<I', b, 4, len(b) - 8 + 4)
    open(p,'wb').write(bytes(b))

for f in [sine16_mono, stereo8, tri24, float32stereo, meta, clipped, silent, wrongsize]:
    f(); print('made', f.__name__)
