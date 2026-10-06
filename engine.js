/* RiffLens engine - RIFF/WAVE inspector.
   Hand-rolled chunk walker, WAVE fmt parsing (PCM int 8/16/24/32, IEEE float
   32/64, WAVE_FORMAT_EXTENSIBLE), sample decoding, per-channel stats, LIST-INFO
   metadata, cue chunks, and a tone-synth WAV builder for demoing.
   No dependencies. Works in browser (ArrayBuffer) and node. */
(function(root){
'use strict';

const INFO_KEYS = {INAM:'Title',IART:'Artist',ICMT:'Comment',ICRD:'Date',IGNR:'Genre',ISFT:'Software',ICOP:'Copyright',IENG:'Engineer',IPRD:'Product',ITCH:'Technician',ISBJ:'Subject',ILGT:'Lightness',IMED:'Medium',IPLT:'Palette setting',IARL:'Archival location',ICMS:'Commissioned',ICNT:'Country',IKEY:'Keywords',IWRI:'Writer',ISRC:'Source'};

function u16(v,o){ return v[o] | (v[o+1]<<8); }
function i16(v,o){ const x=u16(v,o); return x>=0x8000?x-0x10000:x; }
function u32(v,o){ return (v[o] | (v[o+1]<<8) | (v[o+2]<<16) | (v[o+3]<<24))>>>0; }
function i32(v,o){ const x=u32(v,o); return x>=0x80000000?x-0x100000000:x; }
function i24(v,o){ let x=v[o]|(v[o+1]<<8)|(v[o+2]<<16); return x>=0x800000?x-0x1000000:x; }
function f32(v,o){ return new Float32Array(new Uint8Array(v.slice(o,o+4)).buffer)[0]; }
function f64(v,o){ return new Float64Array(new Uint8Array(v.slice(o,o+8)).buffer)[0]; }
function fourCC(v,o){ return String.fromCharCode(v[o],v[o+1],v[o+2],v[o+3]); }

function walkChunks(v, start, end, warnings){
  const chunks=[];
  let o=start;
  while(o+8<=end){
    const id=fourCC(v,o), size=u32(v,o+4);
    const dataOffset=o+8;
    if(dataOffset+size>end){ warnings.push('Chunk "'+id+'" at offset '+o+' declares '+size+' bytes but only '+(end-dataOffset)+' remain - truncated'); chunks.push({id:id,size:size,offset:o,dataOffset:dataOffset,truncated:true}); break; }
    chunks.push({id:id,size:size,offset:o,dataOffset:dataOffset,pad:size%2===1});
    o=dataOffset+size+(size%2);
  }
  if(o<end) warnings.push((end-o)+' trailing byte(s) after last chunk');
  return chunks;
}

function parseFmt(v, off, size, warnings){
  const tag=u16(v,off), channels=u16(v,off+2), rate=u32(v,off+4);
  const byteRate=u32(v,off+8), blockAlign=u16(v,off+12), bits=u16(v,off+14);
  const fmt={tag:tag,channels:channels,rate:rate,byteRate:byteRate,blockAlign:blockAlign,bits:bits};
  if(tag===0xFFFE && size>=40){
    fmt.extensible=true;
    fmt.validBits=u16(v,off+18);
    fmt.channelMask=u32(v,off+20);
    fmt.subFormat=u16(v,off+24); /* first 2 bytes of GUID */
    fmt.tagName = fmt.subFormat===1?'PCM (extensible)':fmt.subFormat===3?'IEEE float (extensible)':'extensible tag 0x'+fmt.subFormat.toString(16);
  } else {
    fmt.tagName = tag===1?'PCM':tag===3?'IEEE float':tag===6?'A-law':tag===7?'mu-law':tag===0x55?'MP3':('unknown (0x'+tag.toString(16)+')');
  }
  const eff = fmt.extensible?fmt.subFormat:tag;
  fmt.effectiveTag=eff;
  if(eff!==1 && eff!==3) warnings.push('Non-PCM format "'+fmt.tagName+'" - samples not decoded');
  if(blockAlign!==Math.ceil(channels*bits/8) && (eff===1||eff===3)) warnings.push('blockAlign '+blockAlign+' != channels*bits/8 = '+Math.ceil(channels*bits/8));
  return fmt;
}

function decodeSamples(v, fmt, dataOff, dataSize){
  const ch=fmt.channels, ba=fmt.blockAlign;
  const frames=Math.floor(dataSize/ba);
  const out=[];
  for(let c=0;c<ch;c++) out.push(new Float64Array(frames));
  const eff=fmt.effectiveTag, bits=fmt.bits;
  for(let f=0;f<frames;f++){
    const base=dataOff+f*ba;
    for(let c=0;c<ch;c++){
      let s=0;
      const o=base+c*(bits/8);
      if(eff===1){
        if(bits===8) s=(v[o]-128)/128;
        else if(bits===16) s=i16(v,o)/32768;
        else if(bits===24) s=i24(v,o)/8388608;
        else if(bits===32) s=i32(v,o)/2147483648;
      } else if(eff===3){
        if(bits===32) s=f32(v,o);
        else if(bits===64) s=f64(v,o);
      }
      out[c][f]=s;
    }
  }
  return out;
}

function channelStats(samples){
  let peak=0, sum=0, sumSq=0, clipped=0, peakIdx=0;
  const n=samples.length;
  for(let i=0;i<n;i++){
    const s=samples[i], a=Math.abs(s);
    if(a>peak){peak=a;peakIdx=i;}
    sum+=s; sumSq+=s*s;
    if(a>=0.9999) clipped++;
  }
  return {peak:peak, peakIdx:peakIdx, dc:n?sum/n:0, rms:n?Math.sqrt(sumSq/n):0, clipped:clipped};
}

function parseListInfo(v, off, size){
  const info={};
  const end=off+size;
  if(fourCC(v,off)!=='INFO') return info;
  let o=off+4;
  while(o+8<=end){
    const key=fourCC(v,o), sz=u32(v,o+4);
    let str='';
    for(let i=0;i<sz && o+8+i<end;i++){ const c=v[o+8+i]; if(c===0) break; str+=String.fromCharCode(c); }
    info[key]=str;
    o+=8+sz+(sz%2);
  }
  return info;
}

function parseCue(v, off){
  return u32(v,off);
}

function analyze(bytes){
  const v = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const warnings=[];
  if(v.length<12) throw new Error('Too small to be RIFF');
  if(fourCC(v,0)!=='RIFF') throw new Error('Not a RIFF file (missing RIFF header)');
  const riffSize=u32(v,4);
  if(riffSize+8!==v.length) warnings.push('RIFF size field says '+(riffSize+8)+' bytes, file is '+v.length);
  const formType=fourCC(v,8);
  if(formType!=='WAVE') warnings.push('RIFF form type is "'+formType+'", not WAVE - fmt/data fields only apply to WAVE');
  const chunks=walkChunks(v,12,v.length,warnings);
  const r={formType:formType, riffSize:riffSize, fileSize:v.length, chunks:chunks.map(function(c){return {id:c.id,size:c.size,offset:c.offset,pad:!!c.pad,truncated:!!c.truncated};}), warnings:warnings};
  const fmtC=chunks.find(function(c){return c.id==='fmt ';});
  const dataC=chunks.find(function(c){return c.id==='data';});
  if(fmtC){
    r.fmt=parseFmt(v,fmtC.dataOffset,fmtC.size,warnings);
  } else warnings.push('No fmt chunk');
  if(dataC && r.fmt){
    r.dataBytes=dataC.size;
    r.frames=Math.floor(dataC.size/r.fmt.blockAlign);
    r.durationSec=r.frames/r.fmt.rate;
    if(r.fmt.effectiveTag===1||r.fmt.effectiveTag===3){
      const chans=decodeSamples(v,r.fmt,dataC.dataOffset,dataC.size);
      r.channels=chans.map(channelStats);
      r._samples=chans; /* internal, for waveform rendering */
    }
  } else if(!dataC) warnings.push('No data chunk');
  const listC=chunks.find(function(c){return c.id==='LIST';});
  if(listC){
    r.info=parseListInfo(v,listC.dataOffset,listC.size);
    r.infoNamed={};
    Object.keys(r.info).forEach(function(k){ r.infoNamed[INFO_KEYS[k]||k]=r.info[k]; });
  }
  const cueC=chunks.find(function(c){return c.id==='cue ';});
  if(cueC) r.cuePoints=parseCue(v,cueC.dataOffset);
  const factC=chunks.find(function(c){return c.id==='fact';});
  if(factC) r.factFrames=u32(v,factC.dataOffset);
  return r;
}

/* Tone-synth WAV builder: builds real RIFF bytes (used by UI presets + roundtrip tests) */
function buildToneWav(opts){
  const freq=opts.freq||440, seconds=opts.seconds||1, rate=opts.rate||44100;
  const bits=opts.bits||16, ch=opts.channels||1, type=opts.type||'sine';
  const floatFmt=bits===32&&opts.float===true;
  const tag=floatFmt?3:1;
  const bytesPer=bits/8, frames=Math.floor(seconds*rate);
  const ba=ch*bytesPer, dataSize=frames*ba;
  const fmtSize=16, riffSize=4+(8+fmtSize)+(8+dataSize);
  const buf=new Uint8Array(8+riffSize);
  const dv=new DataView(buf.buffer);
  function w4(o,s){ for(let i=0;i<4;i++) buf[o+i]=s.charCodeAt(i); }
  w4(0,'RIFF'); dv.setUint32(4,riffSize,true); w4(8,'WAVE');
  w4(12,'fmt '); dv.setUint32(16,fmtSize,true);
  dv.setUint16(20,tag,true); dv.setUint16(22,ch,true); dv.setUint32(24,rate,true);
  dv.setUint32(28,rate*ba,true); dv.setUint16(32,ba,true); dv.setUint16(34,bits,true);
  w4(36,'data'); dv.setUint32(40,dataSize,true);
  let seed=42;
  function rnd(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x40000000-1; }
  for(let f=0;f<frames;f++){
    const t=f/rate;
    for(let c=0;c<ch;c++){
      const fq=freq*(c===1?1.5:1);
      let s;
      if(type==='sine') s=0.8*Math.sin(2*Math.PI*fq*t);
      else if(type==='square') s=Math.sin(2*Math.PI*fq*t)>=0?0.8:-0.8;
      else if(type==='clip') s=2.5*Math.sin(2*Math.PI*fq*t);
      else if(type==='sweep') s=0.8*Math.sin(2*Math.PI*(fq+fq*t)*t);
      else if(type==='noise') s=0.5*rnd();
      else s=0;
      if(s>1)s=1; if(s<-1)s=-1;
      const o=44+f*ba+c*bytesPer;
      if(floatFmt){ dv.setFloat32(o,s,true); }
      else if(bits===8){ dv.setUint8(o,Math.round((s+1)*127.5)); }
      else if(bits===16){ dv.setInt16(o,Math.round(s*32767),true); }
      else if(bits===24){ const x=Math.round(s*8388607); buf[o]=x&255; buf[o+1]=(x>>8)&255; buf[o+2]=(x>>16)&255; }
      else if(bits===32){ dv.setInt32(o,Math.round(s*2147483647),true); }
    }
  }
  return buf;
}

const api={analyze:analyze, buildToneWav:buildToneWav};
if(typeof module!=='undefined'&&module.exports) module.exports=api;
root.RiffLens=api;
})(typeof self!=='undefined'?self:globalThis);
