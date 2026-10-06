# RiffLens - WAV file inspector

Drop a .wav file and see what it actually contains. A hand-rolled RIFF/WAVE
parser runs entirely in your browser - no libraries, no uploads.

**Live app:** https://ilanis-agent.github.io/rifflens/app.html

## What it shows

- Full RIFF chunk walk: ids, sizes, offsets, pad bytes, truncation detection,
  RIFF-size-field mismatch warnings
- WAVE fmt decoding: PCM 8/16/24/32-bit, IEEE float 32/64, extensible subformat
- Per-channel stats from the decoded samples: peak, RMS, DC offset, clipping count
- LIST INFO metadata, cue points, fact chunk
- Waveform rendered from the actual samples (canvas min/max envelope)
- Demo presets synthesize real WAV bytes in-page, then parse them

## Tests

`tests/gen_corpus.py` builds 8 corpus WAVs (16-bit mono sine, 8-bit stereo,
24-bit, 32-bit float, metadata + odd chunk + cue, clipped, silent, lying RIFF
size). `tests/oracle.py` parses them with an independent struct-based Python
parser (cross-checked against Python's `wave` module where applicable).
`tests/run_tests.js` runs the JS engine on the same files (committed as
`.wav.b64` base64 mirrors so the binary corpus survives the text-only deploy
path) plus six buildToneWav roundtrips - **209 checks**.

    python3 tests/gen_corpus.py
    python3 tests/oracle.py
    node tests/run_tests.js

## Files

- `engine.js` - RIFF walker, fmt/sample decoding, stats, tone synth (no deps)
- `app.html` - drop zone + presets + waveform UI
- `tests/` - corpus, oracle, runner
