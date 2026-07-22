/**
 * AudioForge ZeroHour — Audio Engine Module
 * v1.4-modular
 *
 * Extracted from the monolithic index.html and converted to ES6 module.
 * Dependencies: ./recorder-processor.js (AudioWorklet), ./wasm-module.js (optional WASM)
 *
 * Usage:
 *   import { AudioEngine } from './audio-engine.js';
 *   const engine = new AudioEngine();
 */

/**
 * Creates an OscillatorNode periodic wave with phase offset.
 * @param {AudioContext} ctx
 * @param {string} type - 'sine'|'square'|'sawtooth'|'triangle'
 * @param {number} phaseAngle - phase in degrees
 */
function createPeriodicWaveWithPhase(ctx, type, phaseAngle) {
  const real = new Float32Array(1024);
  const imag = new Float32Array(1024);
  const Q = ((phaseAngle % 360) * Math.PI) / 180;
  for (let R = 1; R < 1024; R++) {
    let O = 0,
      A = 0;
    if (type === "sine") {
      if (R === 1) A = 1;
    } else if (type === "square") {
      if (R % 2 !== 0) A = 4 / (R * Math.PI);
    } else if (type === "sawtooth") {
      A = (2 / (R * Math.PI)) * (R % 2 === 0 ? -1 : 1);
    } else if (type === "triangle" && R % 2 !== 0) {
      const E = ((R - 1) / 2) % 2 === 0 ? 1 : -1;
      A = (8 / (Math.PI * Math.PI * R * R)) * E;
    }
    real[R] = O * Math.cos(R * Q) - A * Math.sin(R * Q);
    imag[R] = A * Math.cos(R * Q) + O * Math.sin(R * Q);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/**
 * Pitch-shifts an AudioBuffer by pitchRatio using a grain-based method.
 */
function pitchShiftBuffer(audioBuffer, context, pitchRatio) {
  if (Math.abs(pitchRatio - 1) < 0.005) return audioBuffer;
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const outputBuffer = context.createBuffer(
    numChannels,
    numSamples,
    sampleRate,
  );
  for (let channel = 0; channel < numChannels; channel++) {
    const inputData = audioBuffer.getChannelData(channel);
    const outputData = outputBuffer.getChannelData(channel);
    const grainSize = 1024,
      overlap = 512,
      hopSize = grainSize - overlap;
    const win = new Float32Array(grainSize);
    for (let i = 0; i < grainSize; i++)
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
    const acc = new Float32Array(numSamples + grainSize);
    const wgt = new Float32Array(numSamples + grainSize);
    for (let pos = 0; pos < numSamples - grainSize; pos += hopSize) {
      for (let i = 0; i < grainSize; i++) {
        const ri = Math.min(numSamples - 1, Math.round(pos + i * pitchRatio));
        const val = inputData[ri] * win[i];
        acc[pos + i] += val;
        wgt[pos + i] += win[i];
      }
    }
    for (let i = 0; i < numSamples; i++)
      outputData[i] = wgt[i] > 0.01 ? acc[i] / wgt[i] : 0;
  }
  return outputBuffer;
}

// Default sine LFO wavetable (2048 samples)
function _buildDefaultSineTable() {
  const points = [
    { time: 0, value: 0 },
    { time: 0.25, value: 1 },
    { time: 0.5, value: 0 },
    { time: 0.75, value: -1 },
    { time: 1, value: 0 },
  ];
  const n = 2048;
  const table = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // Linear interpolation between adjacent control points
    let lo = points[0],
      hi = points[points.length - 1];
    for (let k = 0; k < points.length - 1; k++) {
      if (t >= points[k].time && t <= points[k + 1].time) {
        lo = points[k];
        hi = points[k + 1];
        break;
      }
    }
    const span = hi.time - lo.time;
    table[i] =
      span <= 1e-6
        ? lo.value
        : lo.value + (hi.value - lo.value) * ((t - lo.time) / span);
  }
  return table;
}
const DEFAULT_SINE_TABLE = _buildDefaultSineTable();

export class AudioEngine {
  constructor() {
    ((this.context = null),
      (this.globalGain = null),
      (this.masterVolumeNode = null),
      (this.recordingBitDepth = 32),
      (this.activeNodes = new Map()),
      (this.sourceConfigs = new Map()),
      (this.isGlobalPlaying = !1),
      (this.isSoloMode = !1),
      (this.globalEnvelopeMultiplier = 1),
      (this.masterLfoEnabled = !1),
      (this.masterLfoOsc = null),
      (this.masterLfoGain = null),
      (this.masterLfoFreq = 1),
      (this.masterLfoDepth = 0.2),
      (this.masterLfoType = "sine"),
      (this.audioOptions = { sampleRate: null, latencyHint: "balanced" }),
      (this.pitchShiftCache = new Map()),
      (this.groupNodes = new Map()),
      (this.groupsConfig = new Map()));
  }
  getMasterAnalyser() {
    return this.masterAnalyser;
  }
  getContext() {
    if (!this.context) {
      const f = { latencyHint: this.audioOptions.latencyHint };
      (this.audioOptions.sampleRate &&
        (f.sampleRate = this.audioOptions.sampleRate),
        (this.context = new (window.AudioContext || window.webkitAudioContext)(
          f,
        )));
      const _wpUrl = new URL("./recorder-processor.js", import.meta.url).href;
      (this.context.audioWorklet
        .addModule(_wpUrl)
        .then(() => {
          (console.log("Recorder Worklet Loaded"), (this.workletLoaded = !0));
        })
        .catch((g) => console.error("Worklet load error:", g)),
        (this.masterVolumeNode = this.context.createGain()),
        (this.masterVolumeNode.gain.value = 1),
        (this.globalGain = this.context.createGain()),
        (this.recDest = this.context.createMediaStreamDestination()),
        (this.recGain = this.context.createGain()),
        (this.recGain.gain.value = 1),
        this.globalGain.connect(this.masterVolumeNode),
        this.masterVolumeNode.connect(this.context.destination),
        (this.masterAnalyser = this.context.createAnalyser()),
        (this.masterAnalyser.fftSize = 2048),
        this.masterVolumeNode.connect(this.masterAnalyser),
        this.masterVolumeNode.connect(this.recGain),
        this.recGain.connect(this.recDest),
        (this.mediaRecorder = null),
        (this.recorderChunks = []));
    }
    return this.context;
  }
  async restartContext(f) {
    (this.stopAll(),
      (this.isMasterRecording = !1),
      this.groupNodes.forEach((n) => {
        try {
          this._cleanupGroupNodes(n);
        } catch {}
      }),
      this.groupNodes.clear(),
      this.pitchShiftCache.clear(),
      this.context &&
        (await this.context.close(),
        (this.context = null),
        (this.masterVolumeNode = null),
        (this.globalGain = null),
        (this.recDest = null),
        (this.recGain = null),
        (this.masterAnalyser = null),
        (this.workletLoaded = !1)),
      f && (this.audioOptions = { ...this.audioOptions, ...f }),
      this.getContext(),
      this.groupsConfig.forEach((g) => {
        try {
          this.updateGroupParams(g);
        } catch (e) {
          console.warn("Group rebuild after restart failed:", e);
        }
      }));
  }
  async resume() {
    const f = this.getContext();
    f.state === "suspended" && (await f.resume());
  }
  startMasterRecording(f = 0, x = "wav", o = 32, g = 128) {
    const T = this.getContext();
    if (this.isMasterRecording) return;
    ((this.recorderChunks = []),
      (this.wavLeftBuffers = []),
      (this.wavRightBuffers = []),
      (this.wavRecLength = 0),
      (this.recordingFormat = x),
      (this.recordingBitDepth = o),
      (this.isMasterRecording = !0));
    const Q = T.currentTime;
    if (
      (this.recGain.gain.cancelScheduledValues(Q),
      f > 0
        ? (this.recGain.gain.setValueAtTime(0, Q),
          this.recGain.gain.linearRampToValueAtTime(1, Q + f))
        : this.recGain.gain.setValueAtTime(1, Q),
      x === "webm")
    ) {
      const R = this.recDest.stream;
      let O = { mimeType: "audio/webm" };
      const A = g * 1e3;
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? (O = { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: A })
        : MediaRecorder.isTypeSupported("audio/webm") &&
          (O = { mimeType: "audio/webm", audioBitsPerSecond: A });
      try {
        this.mediaRecorder = new MediaRecorder(R, O);
      } catch (E) {
        (console.error("MediaRecorder init failed:", E),
          alert("Recording not supported."),
          (this.isMasterRecording = !1));
        return;
      }
      ((this.mediaRecorder.ondataavailable = (E) => {
        E.data.size > 0 && this.recorderChunks.push(E.data);
      }),
        this.mediaRecorder.start(),
        console.log(`Master WebM Recording Started (${g} kbps)`));
    } else {
      (console.log("Master WAV Recording Started (ScriptProcessor)"),
        (this._wavActive = !0));
      const sp = T.createScriptProcessor(4096, 2, 2);
      ((this.wavScriptNode = sp),
        (sp.onaudioprocess = (e) => {
          if (!this._wavActive) return;
          const ib = e.inputBuffer,
            inL = ib.getChannelData(0),
            inR = ib.numberOfChannels > 1 ? ib.getChannelData(1) : inL;
          (this.wavLeftBuffers.push(new Float32Array(inL)),
            this.wavRightBuffers.push(new Float32Array(inR)),
            (this.wavRecLength += inL.length));
        }),
        this.recGain.connect(sp),
        sp.connect(T.destination));
    }
  }
  stopMasterRecording(f = 0, x) {
    if (!this.isMasterRecording) return;
    const o = this.getContext(),
      g = o.currentTime;
    this.isMasterRecording = !1;
    const T = () => {
      setTimeout(() => {
        try {
          this.recGain &&
            this.recGain.gain &&
            (this.recGain.gain.cancelScheduledValues(o.currentTime),
            (this.recGain.gain.value = 1));
        } catch (Q) {
          console.warn("Gain reset error:", Q);
        }
      }, 100);
      try {
        if (this.recordingFormat === "webm")
          this.mediaRecorder &&
            this.mediaRecorder.state !== "inactive" &&
            (this.mediaRecorder.stop(),
            (this.mediaRecorder.onstop = () => {
              const Q = new Blob(this.recorderChunks, { type: "audio/webm" }),
                R = URL.createObjectURL(Q);
              x && x(R);
            }));
        else {
          this._wavActive = !1;
          if (this.wavScriptNode) {
            try {
              (this.wavScriptNode.disconnect(),
                (this.wavScriptNode.onaudioprocess = null));
            } catch (Q) {
              console.warn("ScriptNode cleanup error:", Q);
            }
            this.wavScriptNode = null;
          }
          if (
            this.wavLeftBuffers &&
            this.wavRightBuffers &&
            this.wavRecLength > 0
          ) {
            const Q = this._mergeBuffers(
                this.wavLeftBuffers,
                this.wavRecLength,
              ),
              R = this._mergeBuffers(this.wavRightBuffers, this.wavRecLength),
              O = this._encodeWAV(Q, R, o.sampleRate),
              A = URL.createObjectURL(O);
            x && x(A);
          } else (console.warn("No recording data available"), x && x(null));
        }
        console.log("Master Recording Stopped");
      } catch (Q) {
        (console.error("Error stopping/encoding recording:", Q), x && x(null));
      }
    };
    try {
      this.recGain && this.recGain.gain
        ? (this.recGain.gain.cancelScheduledValues(g),
          f > 0 && f < 60
            ? (this.recGain.gain.setValueAtTime(this.recGain.gain.value, g),
              this.recGain.gain.linearRampToValueAtTime(0, g + f),
              setTimeout(T, Math.min(f * 1e3 + 50, 6e4)))
            : (this.recGain.gain.setValueAtTime(0, g), T()))
        : T();
    } catch (Q) {
      (console.error("Fade out error", Q), T());
    }
  }
  _mergeBuffers(f, x) {
    const o = new Float32Array(x);
    let g = 0;
    for (let T = 0; T < f.length; T++) (o.set(f[T], g), (g += f[T].length));
    return o;
  }
  _encodeWAV(f, x, o) {
    const g = this.recordingBitDepth === 32,
      Q = 2 * (g ? 4 : 2),
      R = new ArrayBuffer(44 + f.length * Q),
      O = new DataView(R),
      A = (E, S, _) => {
        for (let le = 0; le < _.length; le++)
          E.setUint8(S + le, _.charCodeAt(le));
      };
    if (
      (A(O, 0, "RIFF"),
      O.setUint32(4, 36 + f.length * Q, !0),
      A(O, 8, "WAVE"),
      A(O, 12, "fmt "),
      O.setUint32(16, 16, !0),
      O.setUint16(20, g ? 3 : 1, !0),
      O.setUint16(22, 2, !0),
      O.setUint32(24, o, !0),
      O.setUint32(28, o * Q, !0),
      O.setUint16(32, Q, !0),
      O.setUint16(34, g ? 32 : 16, !0),
      A(O, 36, "data"),
      O.setUint32(40, f.length * Q, !0),
      g)
    ) {
      const E = new Float32Array(R, 44);
      for (let i = 0, j = 0; i < f.length; i++)
        ((E[j++] = f[i]), (E[j++] = x[i]));
    } else {
      const E = new Int16Array(R, 44);
      for (let i = 0, j = 0; i < f.length; i++) {
        const L = Math.max(-1, Math.min(1, f[i])),
          Rr = Math.max(-1, Math.min(1, x[i]));
        ((E[j++] = L < 0 ? L * 32768 : L * 32767),
          (E[j++] = Rr < 0 ? Rr * 32768 : Rr * 32767));
      }
    }
    return new Blob([O], { type: "audio/wav" });
  }
  clearPitchShiftCache(f) {
    for (const x of this.pitchShiftCache.keys())
      x.startsWith(`${f}_`) && this.pitchShiftCache.delete(x);
  }
  updateMasterVolumeLfos(lfos) {
    this.masterLfosConfig = lfos;
    const ctx = this.getContext();
    const time = ctx.currentTime;
    const activeIds = new Set(lfos.filter((l) => l.enabled).map((l) => l.id));
    this.masterLfos || (this.masterLfos = new Map());
    this.masterLfos.forEach((lfoNodes, lfoId) => {
      if (!activeIds.has(lfoId)) {
        try {
          lfoNodes.osc.stop();
        } catch (e) {}
        try {
          lfoNodes.osc.disconnect();
        } catch (e) {}
        try {
          lfoNodes.gain.disconnect();
        } catch (e) {}
        this.masterLfos.delete(lfoId);
      }
    });
    lfos.forEach((lfo) => {
      if (!lfo.enabled) return;
      const freq = lfo.frequency * (lfo.multiplier || 1);
      const depth = lfo.depth;
      const type = lfo.type || "sine";
      const target = lfo.target || "volume";
      let lfoNodes = this.masterLfos.get(lfo.id);
      if (lfoNodes) {
        // If type changed to/from custom, restart the LFO node
        const typeChanged = lfoNodes.type !== type;
        if (typeChanged) {
          try {
            lfoNodes.osc.stop();
          } catch (e) {}
          try {
            lfoNodes.osc.disconnect();
          } catch (e) {}
          try {
            lfoNodes.gain.disconnect();
          } catch (e) {}
          this.masterLfos.delete(lfo.id);
          // Will be recreated in else branch below on next iteration
          // Force recreation by setting lfoNodes to null
          lfoNodes = null;
        } else {
          if (!typeChanged && type === "custom" && lfoNodes.osc.playbackRate) {
            const baseRate =
              ctx.sampleRate /
              ((lfo.waveTable && lfo.waveTable.length) || 1024);
            lfoNodes.osc.playbackRate.setTargetAtTime(
              freq / baseRate,
              time,
              0.05,
            );
          } else if (
            !typeChanged &&
            lfoNodes.osc.type !== type &&
            ["sine", "square", "sawtooth", "triangle"].includes(type)
          ) {
            lfoNodes.osc.type = type;
          }
          if (!typeChanged && lfoNodes.osc.frequency) {
            lfoNodes.osc.frequency.setTargetAtTime(freq, time, 0.05);
          }
          let scaledDepth = depth;
          if (target === "volume") scaledDepth = depth / 100;
          else if (target === "pitch") scaledDepth = depth * 10;
          else if (target === "lfoMult" || target === "envMult")
            scaledDepth = depth / 100;
          lfoNodes.gain.gain.setTargetAtTime(scaledDepth, time, 0.05);
          if (lfoNodes.target !== target) {
            lfoNodes.gain.disconnect();
            this._connectMasterLfo(lfoNodes.gain, target);
            lfoNodes.target = target;
          }
        } // end if(!typeChanged)
      }
      if (!lfoNodes) {
        try {
          let osc;
          if (type === "custom" && lfo.waveTable && lfo.waveTable.length > 0) {
            // Custom waveform using AudioBufferSourceNode
            const buf = ctx.createBuffer(
              1,
              lfo.waveTable.length,
              ctx.sampleRate,
            );
            buf.copyToChannel(new Float32Array(lfo.waveTable), 0);
            osc = ctx.createBufferSource();
            osc.buffer = buf;
            osc.loop = true;
            const baseRate = ctx.sampleRate / lfo.waveTable.length;
            osc.playbackRate.value = freq / baseRate;
          } else {
            osc = ctx.createOscillator();
            osc.type = ["sine", "square", "sawtooth", "triangle"].includes(type)
              ? type
              : "sine";
            osc.frequency.value = freq;
          }
          const gain = ctx.createGain();
          let scaledDepth = depth;
          if (target === "volume") scaledDepth = depth / 100;
          else if (target === "pitch") scaledDepth = depth * 10;
          else if (target === "lfoMult" || target === "envMult")
            scaledDepth = depth / 100;
          gain.gain.value = scaledDepth;
          osc.connect(gain);
          this._connectMasterLfo(gain, target);
          osc.start(time);
          this.masterLfos.set(lfo.id, { osc, gain, target, type });
        } catch (e) {
          console.error("Master LFO err", e);
        }
      }
    });
  }
  _connectMasterLfo(gainNode, target) {
    const ctx = this.getContext();
    if (!this.masterPitchModNode) {
      this.masterPitchModNode = ctx.createGain();
      this.masterPitchModNode.gain.value = 1;
    }
    if (!this.masterLfoMultModNode) {
      this.masterLfoMultModNode = ctx.createGain();
      this.masterLfoMultModNode.gain.value = 1;
    }
    if (!this.masterEnvMultModNode) {
      this.masterEnvMultModNode = ctx.createGain();
      this.masterEnvMultModNode.gain.value = 1;
    }
    if (target === "volume") {
      gainNode.connect(this.masterVolumeNode.gain);
    } else if (target === "pitch") {
      gainNode.connect(this.masterPitchModNode);
    } else if (target === "lfoMult") {
      gainNode.connect(this.masterLfoMultModNode);
    } else if (target === "envMult") {
      gainNode.connect(this.masterEnvMultModNode);
    }
  }
  _getLfoValueAtTime(lfo, time) {
    const freq = lfo.frequency * (lfo.multiplier || 1);
    const phaseRad = ((lfo.phase || 0) * Math.PI) / 180;
    const angle = 2 * Math.PI * freq * time + phaseRad;
    let val = 0;
    const type = lfo.type || "sine";
    if (type === "sine") {
      val = Math.sin(angle);
    } else if (type === "square") {
      val = Math.sin(angle) >= 0 ? 1 : -1;
    } else if (type === "triangle") {
      val = (Math.asin(Math.sin(angle)) * 2) / Math.PI;
    } else if (type === "sawtooth") {
      val =
        2 * (angle / (2 * Math.PI) - Math.floor(0.5 + angle / (2 * Math.PI)));
    } else if (type === "custom" && lfo.waveTable) {
      const phase = (angle / (2 * Math.PI)) % 1;
      const idx = Math.floor(phase * lfo.waveTable.length);
      val = lfo.waveTable[idx >= 0 ? idx : idx + lfo.waveTable.length] || 0;
    }
    const depth = lfo.depth ?? 0;
    return val * (depth / 100);
  }
  setMasterVolume(f) {
    this.masterVolumeNode &&
      this.masterVolumeNode.gain.setTargetAtTime(
        f,
        this.getContext().currentTime,
        0.05,
      );
  }
  updateMasterVolumeLfo(f, x, o, g) {
    const T = this.getContext(),
      Q = T.currentTime;
    if (
      ((this.masterLfoFreq = f),
      (this.masterLfoDepth = x),
      (this.masterLfoType = o),
      (this.masterLfoEnabled = g),
      !g)
    ) {
      if (this.masterLfoOsc) {
        try {
          this.masterLfoOsc.stop();
        } catch {}
        this.masterLfoOsc = null;
      }
      if (this.masterLfoGain) {
        try {
          this.masterLfoGain.disconnect();
        } catch {}
        this.masterLfoGain = null;
      }
      return;
    }
    if (this.masterLfoOsc && this.masterLfoGain) {
      (this.masterLfoOsc.frequency &&
        this.masterLfoOsc.frequency.setTargetAtTime(f, Q, 0.05),
        this.masterLfoGain.gain.setTargetAtTime(x, Q, 0.05));
      return;
    }
    ((this.masterLfoOsc = T.createOscillator()),
      (this.masterLfoOsc.type = o),
      (this.masterLfoOsc.frequency.value = f),
      (this.masterLfoGain = T.createGain()),
      (this.masterLfoGain.gain.value = x),
      this.masterLfoOsc.connect(this.masterLfoGain),
      this.masterLfoGain.connect(this.masterVolumeNode.gain),
      this.masterLfoOsc.start(Q));
  }
  setSoloMode(f) {
    ((this.isSoloMode = f),
      this.activeNodes.forEach((x, o) => {
        const g = this.sourceConfigs.get(o);
        g && this.updateSourceParams(g);
      }));
    this.groupsConfig.forEach((g) => {
      this.updateGroupParams(g);
    });
  }
  stopAll() {
    ((this.isGlobalPlaying = !1),
      this.activeNodes.forEach((f) => {
        this._cleanupNodes(f);
      }),
      this.activeNodes.clear());
  }
  _cleanupNodes(f) {
    try {
      if (
        (f.source &&
          ((f.source.onended = null), f.source.stop(), f.source.disconnect()),
        f.lfos &&
          f.lfos.forEach((x) => {
            try {
              (x.osc.stop(), x.osc.disconnect(), x.gain.disconnect());
            } catch {}
          }),
        f.gain && f.gain.disconnect(),
        f.panner && f.panner.disconnect(),
        f.eqNodes &&
          f.eqNodes.forEach((x) => {
            try {
              x.disconnect();
            } catch {}
          }),
        f.modulationGain && f.modulationGain.disconnect(),
        f.controlBias)
      )
        try {
          (f.controlBias.stop(), f.controlBias.disconnect());
        } catch {}
      (f.masterGain && f.masterGain.disconnect(),
        f.muteGain && f.muteGain.disconnect());
    } catch {}
  }
  updateSourceParams(f) {
    this.sourceConfigs.set(f.id, f);
    if (!this.context) return;
    const o = this.context.currentTime;
    const matchingNodeEntries = [];
    this.activeNodes.forEach((node, key) => {
      if (key === f.id || key.startsWith(f.id + "_")) {
        matchingNodeEntries.push({ node, key });
      }
    });
    if (matchingNodeEntries.length === 0) return;

    const firstNode = matchingNodeEntries[0].node;
    const g = firstNode.config.lfos ? firstNode.config.lfos.length : 0,
      T = f.lfos ? f.lfos.length : 0;
    let Q = [];
    (f.eq && (Array.isArray(f.eq) ? (Q = f.eq) : f.eq.enabled && (Q = [f.eq])),
      Q.filter((A) => A.enabled));
    let R = !1;
    if (
      ((!firstNode.eqNodes || firstNode.eqNodes.length !== Q.length) &&
        (R = !0),
      g !== T && (R = !0),
      f.type === "drawable" &&
        f.waveTable !== firstNode.config.waveTable &&
        (R = !0),
      f.isLfoBypassed !== firstNode.config.isLfoBypassed && (R = !0),
      (f.groupId !== firstNode.config.groupId ||
        JSON.stringify(f.groupIds || []) !==
          JSON.stringify(firstNode.config.groupIds || [])) &&
        (R = !0),
      !R && f.eq && firstNode.config.eq)
    ) {
      const A = Array.isArray(f.eq) ? f.eq : [f.eq],
        E = Array.isArray(firstNode.config.eq)
          ? firstNode.config.eq
          : [firstNode.config.eq];
      if (A.length !== E.length) R = !0;
      else
        for (let S = 0; S < A.length; S++)
          if (A[S].enabled !== E[S].enabled) {
            R = !0;
            break;
          }
    }
    if (!R && f.lfos)
      for (let A = 0; A < f.lfos.length; A++) {
        if (!firstNode.config.lfos[A]) {
          R = !0;
          break;
        }
        if (f.lfos[A].type !== firstNode.config.lfos[A].type) {
          R = !0;
          break;
        }
        if (f.lfos[A].phase !== firstNode.config.lfos[A].phase) {
          R = !0;
          break;
        }
        if (
          !["sine", "square", "sawtooth", "triangle", "custom"].includes(
            f.lfos[A].type,
          ) &&
          f.lfos[A].waveTable !== firstNode.config.lfos[A].waveTable
        ) {
          R = !0;
          break;
        }
        if (f.lfos[A].rateMod !== firstNode.config.lfos[A].rateMod) {
          R = !0;
          break;
        }
        if (f.lfos[A].active !== firstNode.config.lfos[A].active) {
          R = !0;
          break;
        }
        if (f.lfos[A].target !== firstNode.config.lfos[A].target) {
          R = !0;
          break;
        }
        if (
          f.lfos[A].type === "custom" &&
          f.lfos[A].waveTable !== firstNode.config.lfos[A].waveTable
        ) {
          R = !0;
          break;
        }
      }
    if (R) {
      this.restartSource(f.id);
      return;
    }

    matchingNodeEntries.forEach(({ node: x }) => {
      const activeGroupId = x.groupId;
      const grConfig = activeGroupId
        ? this.groupsConfig.get(activeGroupId)
        : null;
      const grPitch = grConfig ? (grConfig.pitch ?? 1) : 1;

      ((x.config = f), (x.loopIndex = f.loopIndex || 0));
      const O =
        (this.isSoloMode && !f.isSolo && (!grConfig || !grConfig.isSolo)) ||
        f.isMuted ||
        (grConfig ? grConfig.isMuted : false);
      if (
        (x.muteGain && x.muteGain.gain.setTargetAtTime(O ? 0 : 1, o, 0.05),
        x.masterGain.gain.setTargetAtTime(f.volume, o, 0.05),
        x.panner.pan.setTargetAtTime(f.pan, o, 0.05),
        x.source instanceof OscillatorNode && f.type === "basic")
      )
        (x.source.frequency.setTargetAtTime(
          f.frequency * (f.globalPitch || 1) * grPitch,
          o,
          0.05,
        ),
          x.source.detune.setTargetAtTime(f.detune, o, 0.05));
      else if (x.source instanceof AudioBufferSourceNode) {
        let A = 1;
        (f.type === "drawable"
          ? (A = this.context.sampleRate / f.waveTable.length)
          : f.type === "sample"
            ? (A = 261.63)
            : f.type === "basic" &&
              f.oscType === "custom" &&
              (A = this.context.sampleRate / f.waveTable.length),
          A === 0 && (A = 1));
        const E = f.frequency / A;
        x.source.playbackRate.setTargetAtTime(
          E * (f.globalPitch || 1) * grPitch,
          o,
          0.05,
        );
      }
      (x.lfos &&
        f.lfos &&
        x.lfos.forEach((A) => {
          const E = f.lfos[A.configIndex];
          if (!E || !E.active || f.isLfoBypassed) {
            try {
              A.gain.gain.setTargetAtTime(0, o, 0.05);
            } catch {}
            return;
          }
          const S =
            (f.globalLfoPitch || 1) * (grConfig ? (grConfig.lfoMult ?? 1) : 1);
          if (A.osc instanceof OscillatorNode)
            A.osc.frequency.setTargetAtTime(E.frequency * S, o, 0.05);
          else if (A.osc instanceof AudioBufferSourceNode) {
            const le = this.context.sampleRate / (E.waveTable.length || 1024);
            A.osc.playbackRate.setTargetAtTime((E.frequency / le) * S, o, 0.05);
          }
          let _ = E.depth;
          if (E.target === "volume" || E.target === "pan") _ = _ / 100;
          else if (E.target === "frequency")
            _ = f.type === "basic" ? _ * 10 : _ / 50;
          else if (
            E.target.startsWith("lfo_") &&
            E.target.endsWith("_frequency")
          )
            _ = _ * 0.3;
          else if (E.target.startsWith("lfo_") && E.target.endsWith("_depth"))
            _ = _ / 100;
          A.gain.gain.setTargetAtTime(_, o, 0.05);
        }),
        x.eqNodes &&
          Q.length === x.eqNodes.length &&
          x.eqNodes.forEach((A, E) => {
            const S = Q[E];
            ((A.type = S.type || "peaking"),
              A.frequency.setTargetAtTime(S.frequency || 1e3, o, 0.05),
              A.Q.setTargetAtTime(S.q || 1, o, 0.05),
              A.gain.setTargetAtTime(S.gain || 0, o, 0.05));
          }));
    });
  }
  _makeDistortionCurve(amount) {
    const k = typeof amount === "number" ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  _createReverbImpulseResponse(ctx, decay) {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * Math.max(0.1, decay);
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
      const pct = i / length;
      const envelope = Math.pow(1 - pct, 2.5);
      left[i] = (Math.random() * 2 - 1) * envelope;
      right[i] = (Math.random() * 2 - 1) * envelope;
    }
    return impulse;
  }

  _getOrCreateGroupNodes(groupId) {
    const ctx = this.getContext();
    const time = ctx.currentTime;
    let nodes = this.groupNodes.get(groupId);
    if (nodes && nodes.groupGain && nodes.groupGain.context !== ctx) {
      try {
        this._cleanupGroupNodes(nodes);
      } catch {}
      this.groupNodes.delete(groupId);
      nodes = null;
    }
    if (!nodes) {
      const groupGain = ctx.createGain();
      groupGain.gain.setValueAtTime(1, time);
      groupGain.connect(this.globalGain);

      const groupMuteGain = ctx.createGain();
      groupMuteGain.gain.setValueAtTime(1, time);
      groupMuteGain.connect(groupGain);

      const groupVolModGain = ctx.createGain();
      groupVolModGain.gain.setValueAtTime(0, time);

      const groupControlBias = ctx.createConstantSource();
      groupControlBias.offset.setValueAtTime(1, time);
      groupControlBias.start(time);

      const groupControlSum = ctx.createGain();
      groupControlSum.gain.setValueAtTime(1, time);

      const groupControlScale = ctx.createGain();
      groupControlScale.gain.setValueAtTime(0.1, time);

      const groupWaveshaper = ctx.createWaveShaper();
      const curveSize = 65536;
      const curve = new Float32Array(curveSize);
      for (let i = 0; i < curveSize; i++) {
        const x = (i / (curveSize - 1)) * 2 - 1;
        curve[i] = x < 0 ? 0 : x;
      }
      groupWaveshaper.curve = curve;

      const groupMultiplierGain = ctx.createGain();
      groupMultiplierGain.gain.setValueAtTime(10, time);

      groupControlBias.connect(groupControlSum);
      groupControlSum.connect(groupControlScale);
      groupControlScale.connect(groupWaveshaper);
      groupWaveshaper.connect(groupMultiplierGain);
      groupMultiplierGain.connect(groupVolModGain.gain);

      // Dynamic FX chain. Starts empty: groupVolModGain -> groupMuteGain.
      // _syncGroupFxChain() rebuilds it from group.fxChain (an ordered
      // list of FX instances) so FX can be reordered, duplicated, and
      // modulated individually.
      groupVolModGain.connect(groupMuteGain);

      // These are pass-through modulation buses: the LFO signal that
      // arrives here is ADDED to the target AudioParam (frequency /
      // playbackRate). They must have gain 1 so the modulation passes
      // through. (They were 0 before, which silently killed all group
      // pitch / LFO-speed modulation.)
      const groupPitchModNode = ctx.createGain();
      groupPitchModNode.gain.setValueAtTime(1, time);

      const groupLfoMultModNode = ctx.createGain();
      groupLfoMultModNode.gain.setValueAtTime(1, time);

      const groupEnvMultModNode = ctx.createGain();
      groupEnvMultModNode.gain.setValueAtTime(1, time);

      nodes = {
        groupGain,
        groupMuteGain,
        groupVolModGain,
        groupControlBias,
        groupControlSum,
        groupControlScale,
        groupWaveshaper,
        groupMultiplierGain,
        groupPitchModNode,
        groupLfoMultModNode,
        groupEnvMultModNode,
        fxInstances: new Map(),
        fxSignature: "",
        lfos: new Map(),
      };
      this.groupNodes.set(groupId, nodes);
    }
    return nodes;
  }

  _fxChainOf(group) {
    if (group && Array.isArray(group.fxChain)) return group.fxChain;
    return this._migrateLegacyFx(group ? group.fx : null);
  }
  _migrateLegacyFx(fx) {
    if (!fx) return [];
    const out = [];
    const mk = (key, o) => ({ id: "lg_" + key, enabled: false, ...o });
    if (fx.eq1)
      out.push(
        mk("eq1", {
          type: "eq",
          enabled: !!fx.eq1.enabled,
          sub: "lowshelf",
          frequency: fx.eq1.frequency ?? 200,
          q: 1,
          gain: fx.eq1.gain ?? 0,
        }),
      );
    if (fx.eq2)
      out.push(
        mk("eq2", {
          type: "eq",
          enabled: !!fx.eq2.enabled,
          sub: "peaking",
          frequency: fx.eq2.frequency ?? 1000,
          q: fx.eq2.q ?? 1,
          gain: fx.eq2.gain ?? 0,
        }),
      );
    if (fx.eq3)
      out.push(
        mk("eq3", {
          type: "eq",
          enabled: !!fx.eq3.enabled,
          sub: "highshelf",
          frequency: fx.eq3.frequency ?? 5000,
          q: 1,
          gain: fx.eq3.gain ?? 0,
        }),
      );
    if (fx.filter)
      out.push(
        mk("filter", {
          type: "filter",
          enabled: !!fx.filter.enabled,
          filterType: fx.filter.type || "lowpass",
          frequency: fx.filter.frequency ?? 1000,
          q: fx.filter.q ?? 1,
        }),
      );
    if (fx.distortion)
      out.push(
        mk("distortion", {
          type: "distortion",
          enabled: !!fx.distortion.enabled,
          amount: fx.distortion.amount ?? 20,
          mix: fx.distortion.mix ?? 0.5,
        }),
      );
    if (fx.delay)
      out.push(
        mk("delay", {
          type: "delay",
          enabled: !!fx.delay.enabled,
          delayTime: fx.delay.delayTime ?? 0.3,
          feedback: fx.delay.feedback ?? 0.4,
          mix: fx.delay.mix ?? 0.5,
        }),
      );
    if (fx.reverb)
      out.push(
        mk("reverb", {
          type: "reverb",
          enabled: !!fx.reverb.enabled,
          decay: fx.reverb.decay ?? 2.0,
          mix: fx.reverb.mix ?? 0.5,
        }),
      );
    if (fx.chorus)
      out.push(
        mk("chorus", {
          type: "chorus",
          enabled: !!fx.chorus.enabled,
          rate: fx.chorus.rate ?? 1.5,
          depth: fx.chorus.depth ?? 0.002,
          mix: fx.chorus.mix ?? 0.5,
        }),
      );
    return out;
  }
  _createGroupFxInstance(ctx, fx) {
    const time = ctx.currentTime;
    const t = fx.type;
    if (t === "eq") {
      const b = ctx.createBiquadFilter();
      b.type = fx.sub || "peaking";
      return {
        type: t,
        input: b,
        output: b,
        biquad: b,
        allNodes: [b],
        oscs: [],
      };
    }
    if (t === "filter") {
      const b = ctx.createBiquadFilter();
      b.type = "allpass";
      b.frequency.setValueAtTime(20000, time);
      return {
        type: t,
        input: b,
        output: b,
        biquad: b,
        allNodes: [b],
        oscs: [],
      };
    }
    if (t === "distortion") {
      const inGain = ctx.createGain();
      const preGain = ctx.createGain();
      preGain.gain.setValueAtTime(1, time);
      const shaper = ctx.createWaveShaper();
      shaper.oversample = "4x";
      shaper.curve = this._makeDistortionCurve(fx.amount ?? 20);
      const dry = ctx.createGain();
      dry.gain.setValueAtTime(1, time);
      const wet = ctx.createGain();
      wet.gain.setValueAtTime(0, time);
      const out = ctx.createGain();
      inGain.connect(dry);
      inGain.connect(preGain);
      preGain.connect(shaper);
      shaper.connect(wet);
      dry.connect(out);
      wet.connect(out);
      return {
        type: t,
        input: inGain,
        output: out,
        preGain,
        shaper,
        dry,
        wet,
        allNodes: [inGain, preGain, shaper, dry, wet, out],
        oscs: [],
      };
    }
    if (t === "delay") {
      const inGain = ctx.createGain();
      const delayNode = ctx.createDelay(5.0);
      delayNode.delayTime.setValueAtTime(fx.delayTime ?? 0.3, time);
      const fb = ctx.createGain();
      fb.gain.setValueAtTime(0, time);
      const dry = ctx.createGain();
      dry.gain.setValueAtTime(1, time);
      const wet = ctx.createGain();
      wet.gain.setValueAtTime(0, time);
      const out = ctx.createGain();
      inGain.connect(dry);
      inGain.connect(delayNode);
      delayNode.connect(fb);
      fb.connect(delayNode);
      delayNode.connect(wet);
      dry.connect(out);
      wet.connect(out);
      return {
        type: t,
        input: inGain,
        output: out,
        delayNode,
        fb,
        dry,
        wet,
        allNodes: [inGain, delayNode, fb, dry, wet, out],
        oscs: [],
      };
    }
    if (t === "reverb") {
      const inGain = ctx.createGain();
      const conv = ctx.createConvolver();
      conv.buffer = this._createReverbImpulseResponse(ctx, fx.decay ?? 2.0);
      const dry = ctx.createGain();
      dry.gain.setValueAtTime(1, time);
      const wet = ctx.createGain();
      wet.gain.setValueAtTime(0, time);
      const out = ctx.createGain();
      inGain.connect(dry);
      inGain.connect(conv);
      conv.connect(wet);
      dry.connect(out);
      wet.connect(out);
      return {
        type: t,
        input: inGain,
        output: out,
        conv,
        dry,
        wet,
        decay: fx.decay ?? 2.0,
        allNodes: [inGain, conv, dry, wet, out],
        oscs: [],
      };
    }
    if (t === "chorus") {
      const inGain = ctx.createGain();
      const delay = ctx.createDelay(0.1);
      delay.delayTime.setValueAtTime(0.015, time);
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(fx.rate ?? 1.5, time);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0, time);
      const dry = ctx.createGain();
      dry.gain.setValueAtTime(1, time);
      const wet = ctx.createGain();
      wet.gain.setValueAtTime(0, time);
      const out = ctx.createGain();
      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);
      lfo.start(time);
      inGain.connect(dry);
      inGain.connect(delay);
      delay.connect(wet);
      dry.connect(out);
      wet.connect(out);
      return {
        type: t,
        input: inGain,
        output: out,
        delay,
        lfo,
        lfoGain,
        dry,
        wet,
        allNodes: [inGain, delay, lfoGain, dry, wet, out],
        oscs: [lfo],
      };
    }
    const g = ctx.createGain();
    return { type: t, input: g, output: g, allNodes: [g], oscs: [] };
  }
  _disposeFxInstance(inst) {
    if (!inst) return;
    (inst.oscs || []).forEach((o) => {
      try {
        o.stop();
      } catch (e) {}
    });
    (inst.allNodes || []).forEach((n) => {
      try {
        n.disconnect();
      } catch (e) {}
    });
  }
  _fxInstanceParamNode(inst, param) {
    if (!inst) return null;
    if (inst.type === "eq") {
      if (param === "frequency") return inst.biquad.frequency;
      if (param === "gain") return inst.biquad.gain;
      if (param === "q") return inst.biquad.Q;
    } else if (inst.type === "filter") {
      if (param === "frequency") return inst.biquad.frequency;
      if (param === "q") return inst.biquad.Q;
    } else if (inst.type === "distortion") {
      if (param === "amount") return inst.preGain.gain;
      if (param === "mix") return inst.wet.gain;
    } else if (inst.type === "delay") {
      if (param === "time") return inst.delayNode.delayTime;
      if (param === "feedback") return inst.fb.gain;
      if (param === "mix") return inst.wet.gain;
    } else if (inst.type === "reverb") {
      if (param === "mix") return inst.wet.gain;
    } else if (inst.type === "chorus") {
      if (param === "rate") return inst.lfo.frequency;
      if (param === "depth") return inst.lfoGain.gain;
      if (param === "mix") return inst.wet.gain;
    }
    return null;
  }
  _setFxInstanceParamDirect(inst, prop, val, time) {
    if (!inst) return;
    if (inst.type === "eq" || inst.type === "filter") {
      if (prop === "frequency")
        inst.biquad.frequency.setTargetAtTime(val, time, 0.01);
      else if (prop === "gain" && inst.biquad.gain)
        inst.biquad.gain.setTargetAtTime(val, time, 0.01);
      else if (prop === "q") inst.biquad.Q.setTargetAtTime(val, time, 0.01);
    } else if (inst.type === "distortion") {
      if (prop === "mix") {
        inst.dry.gain.setTargetAtTime(1 - val, time, 0.01);
        inst.wet.gain.setTargetAtTime(val, time, 0.01);
      } else if (prop === "amount")
        inst.shaper.curve = this._makeDistortionCurve(val);
    } else if (inst.type === "delay") {
      if (prop === "mix") {
        inst.dry.gain.setTargetAtTime(1 - val, time, 0.01);
        inst.wet.gain.setTargetAtTime(val, time, 0.01);
      } else if (prop === "time" || prop === "delayTime")
        inst.delayNode.delayTime.setTargetAtTime(val, time, 0.01);
      else if (prop === "feedback")
        inst.fb.gain.setTargetAtTime(val, time, 0.01);
    } else if (inst.type === "reverb") {
      if (prop === "mix") {
        inst.dry.gain.setTargetAtTime(1 - val, time, 0.01);
        inst.wet.gain.setTargetAtTime(val, time, 0.01);
      }
    } else if (inst.type === "chorus") {
      if (prop === "mix") {
        inst.dry.gain.setTargetAtTime(1 - val, time, 0.01);
        inst.wet.gain.setTargetAtTime(val, time, 0.01);
      } else if (prop === "rate")
        inst.lfo.frequency.setTargetAtTime(val, time, 0.01);
      else if (prop === "depth")
        inst.lfoGain.gain.setTargetAtTime(val, time, 0.01);
    }
  }
  _applyFxInstanceParams(inst, fx, ctx, time) {
    if (!inst) return;
    const en = !!fx.enabled;
    if (inst.type === "eq") {
      inst.biquad.type = fx.sub || "peaking";
      inst.biquad.frequency.setTargetAtTime(fx.frequency ?? 1000, time, 0.05);
      inst.biquad.Q.setTargetAtTime(fx.q ?? 1, time, 0.05);
      inst.biquad.gain.setTargetAtTime(en ? (fx.gain ?? 0) : 0, time, 0.05);
    } else if (inst.type === "filter") {
      inst.biquad.type = en ? fx.filterType || "lowpass" : "allpass";
      inst.biquad.frequency.setTargetAtTime(
        en ? (fx.frequency ?? 1000) : 20000,
        time,
        0.05,
      );
      inst.biquad.Q.setTargetAtTime(en ? (fx.q ?? 1) : 1, time, 0.05);
    } else if (inst.type === "distortion") {
      const mix = en ? (fx.mix ?? 0.5) : 0;
      inst.dry.gain.setTargetAtTime(1 - mix, time, 0.05);
      inst.wet.gain.setTargetAtTime(mix, time, 0.05);
      inst.shaper.curve = this._makeDistortionCurve(fx.amount ?? 20);
    } else if (inst.type === "delay") {
      const mix = en ? (fx.mix ?? 0.5) : 0;
      inst.dry.gain.setTargetAtTime(1 - mix, time, 0.05);
      inst.wet.gain.setTargetAtTime(mix, time, 0.05);
      inst.delayNode.delayTime.setTargetAtTime(
        en ? Math.max(0.001, fx.delayTime ?? 0.3) : 0.001,
        time,
        0.05,
      );
      inst.fb.gain.setTargetAtTime(en ? (fx.feedback ?? 0.4) : 0, time, 0.05);
    } else if (inst.type === "reverb") {
      const mix = en ? (fx.mix ?? 0.5) : 0;
      inst.dry.gain.setTargetAtTime(1 - mix, time, 0.05);
      inst.wet.gain.setTargetAtTime(mix, time, 0.05);
      const decay = fx.decay ?? 2.0;
      if (!inst.decay || Math.abs(inst.decay - decay) > 0.05) {
        inst.decay = decay;
        inst.conv.buffer = this._createReverbImpulseResponse(ctx, decay);
      }
    } else if (inst.type === "chorus") {
      const mix = en ? (fx.mix ?? 0.5) : 0;
      inst.dry.gain.setTargetAtTime(1 - mix, time, 0.05);
      inst.wet.gain.setTargetAtTime(mix, time, 0.05);
      inst.lfo.frequency.setTargetAtTime(
        en ? (fx.rate ?? 1.5) : 0.1,
        time,
        0.05,
      );
      inst.lfoGain.gain.setTargetAtTime(
        en ? (fx.depth ?? 0.002) : 0,
        time,
        0.05,
      );
    }
  }
  _syncGroupFxChain(nodes, fxChain, ctx, time) {
    fxChain = fxChain || [];
    const sig = fxChain.map((f) => f.id + ":" + f.type).join("|");
    if (nodes.fxSignature !== sig) {
      try {
        nodes.groupVolModGain.disconnect();
      } catch (e) {}
      if (nodes.fxInstances)
        nodes.fxInstances.forEach((inst) => this._disposeFxInstance(inst));
      nodes.fxInstances = new Map();
      let prev = nodes.groupVolModGain;
      fxChain.forEach((fx) => {
        const inst = this._createGroupFxInstance(ctx, fx);
        prev.connect(inst.input);
        prev = inst.output;
        nodes.fxInstances.set(fx.id, inst);
      });
      prev.connect(nodes.groupMuteGain);
      nodes.fxSignature = sig;
      if (nodes.lfos)
        nodes.lfos.forEach((ln) => {
          if (ln.target && ln.target.startsWith("fx_")) {
            try {
              ln.gain.disconnect();
            } catch (e) {}
            ln.target = "__stale__";
          }
        });
    }
    fxChain.forEach((fx) => {
      const inst = nodes.fxInstances.get(fx.id);
      if (inst) this._applyFxInstanceParams(inst, fx, ctx, time);
    });
  }
  setParamDirectly(target, val) {
    const ctx = this.getContext();
    const time = ctx.currentTime;
    if (target === "masterVolume") {
      if (this.masterVolumeNode)
        this.masterVolumeNode.gain.setTargetAtTime(val, time, 0.01);
    } else if (target === "masterPitch") {
      this.activeNodes.forEach((x) => {
        if (x.source && x.source.frequency) {
          const baseFreq = x.config.frequency || 440;
          x.source.frequency.setTargetAtTime(baseFreq * val, time, 0.02);
        } else if (x.source && x.source.playbackRate) {
          x.source.playbackRate.setTargetAtTime(val, time, 0.02);
        }
      });
    } else if (target.startsWith("group_")) {
      const match = target.match(/^group_(group_[0-9\.]+)(.*)$/);
      if (match) {
        const groupId = match[1];
        const paramName = match[2].slice(1);
        const nodes = this.groupNodes.get(groupId);
        if (nodes) {
          if (paramName === "volume") {
            nodes.groupGain.gain.setTargetAtTime(val, time, 0.01);
          } else if (paramName.startsWith("fxi_")) {
            const rest = paramName.slice(4);
            const li = rest.lastIndexOf("_");
            if (li > 0) {
              const instId = rest.slice(0, li);
              const prop = rest.slice(li + 1);
              const inst = nodes.fxInstances && nodes.fxInstances.get(instId);
              this._setFxInstanceParamDirect(inst, prop, val, time);
            }
          } else if (paramName.startsWith("fx_")) {
            const fxParam = paramName.slice(3);
            const fxParts = fxParam.split("_");
            const fxName = fxParts[0];
            const fxProp = fxParts[1];
            const node = nodes[fxName];
            if (node) {
              if (fxProp === "frequency" && node.frequency) {
                node.frequency.setTargetAtTime(val, time, 0.01);
              } else if (fxProp === "gain" && node.gain) {
                node.gain.setTargetAtTime(val, time, 0.01);
              } else if (fxProp === "q" && node.Q) {
                node.Q.setTargetAtTime(val, time, 0.01);
              } else if (fxProp === "delayTime" && node.delayTime) {
                node.delayTime.setTargetAtTime(val, time, 0.01);
              } else if (fxProp === "feedback" && nodes.delayFeedback) {
                nodes.delayFeedback.gain.setTargetAtTime(val, time, 0.01);
              } else if (fxProp === "mix") {
                if (fxName === "distortion") {
                  nodes.distDry.gain.setTargetAtTime(1 - val, time, 0.01);
                  nodes.distWet.gain.setTargetAtTime(val, time, 0.01);
                } else if (fxName === "delay") {
                  nodes.delayDry.gain.setTargetAtTime(1 - val, time, 0.01);
                  nodes.delayWet.gain.setTargetAtTime(val, time, 0.01);
                } else if (fxName === "reverb") {
                  nodes.reverbDry.gain.setTargetAtTime(1 - val, time, 0.01);
                  nodes.reverbWet.gain.setTargetAtTime(val, time, 0.01);
                } else if (fxName === "chorus") {
                  nodes.chorusDry.gain.setTargetAtTime(1 - val, time, 0.01);
                  nodes.chorusWet.gain.setTargetAtTime(val, time, 0.01);
                }
              }
            }
          }
        }
      }
    } else if (target.startsWith("source_")) {
      const match = target.match(/^source_([0-9\.]+)(.*)$/);
      if (match) {
        const sourceId = match[1];
        const paramName = match[2].slice(1);
        const x = this.activeNodes.get(sourceId);
        if (x) {
          if (paramName === "volume") {
            x.masterGain.gain.setTargetAtTime(val, time, 0.01);
          } else if (paramName === "frequency") {
            if (x.source && x.source.frequency) {
              x.source.frequency.setTargetAtTime(val, time, 0.01);
            } else if (x.source && x.source.playbackRate) {
              x.source.playbackRate.setTargetAtTime(val / 261.63, time, 0.01);
            }
          } else if (paramName === "pan") {
            x.panner.pan.setTargetAtTime(val, time, 0.01);
          }
        }
      }
    }
  }
  updateGroupParams(group) {
    this.groupsConfig.set(group.id, group);
    const nodes = this._getOrCreateGroupNodes(group.id);
    const ctx = this.getContext();
    const time = ctx.currentTime;
    nodes.groupGain.gain.setTargetAtTime(group.volume, time, 0.05);
    let groupHasSolo = false;
    this.sourceConfigs.forEach((cfg) => {
      if (cfg && cfg.groupId === group.id && cfg.isSolo) groupHasSolo = true;
    });
    const isMuted =
      group.isMuted || (this.isSoloMode && !group.isSolo && !groupHasSolo);
    nodes.groupMuteGain.gain.setTargetAtTime(isMuted ? 0 : 1, time, 0.05);

    // Apply group FX chain (dynamic: ordered, multi-instance, per-instance modulation).
    this._syncGroupFxChain(nodes, this._fxChainOf(group), ctx, time);

    const activeLfoIds = new Set(
      (group.lfos || []).filter((l) => l.active).map((l) => l.id),
    );
    nodes.lfos.forEach((lfoNodes, lfoId) => {
      if (!activeLfoIds.has(lfoId)) {
        try {
          lfoNodes.osc.stop();
        } catch (e) {}
        try {
          lfoNodes.osc.disconnect();
        } catch (e) {}
        try {
          lfoNodes.gain.disconnect();
        } catch (e) {}
        nodes.lfos.delete(lfoId);
      }
    });
    (group.lfos || []).forEach((lfo) => {
      if (!lfo.active) return;
      const freq = lfo.frequency * (group.lfoMult || 1);
      const depth = lfo.depth;
      const type = lfo.type || "sine";
      const target = lfo.target || "volume";
      let lfoNodes = nodes.lfos.get(lfo.id);
      if (lfoNodes) {
        if (
          lfoNodes.osc.type !== type &&
          ["sine", "square", "sawtooth", "triangle"].includes(type)
        ) {
          lfoNodes.osc.type = type;
        }
        if (lfoNodes.osc.frequency) {
          lfoNodes.osc.frequency.setTargetAtTime(freq, time, 0.05);
        } else if (lfoNodes.osc.playbackRate) {
          const baseRate = ctx.sampleRate / (lfo.waveTable.length || 1024);
          lfoNodes.osc.playbackRate.setTargetAtTime(
            freq / baseRate,
            time,
            0.05,
          );
        }
        let scaledDepth = depth;
        if (target === "volume") scaledDepth = depth / 100;
        else if (target === "pitch") scaledDepth = depth * 10;
        else if (target === "lfoMult" || target === "envMult")
          scaledDepth = depth / 100;
        else if (target.endsWith("_frequency")) scaledDepth = depth * 50;
        else if (target.endsWith("_gain")) scaledDepth = depth * 1.5;
        else if (
          target.endsWith("_mix") ||
          target.endsWith("_feedback") ||
          target.endsWith("_depth")
        )
          scaledDepth = depth / 100;
        else if (target.endsWith("_q")) scaledDepth = depth / 10;
        else if (target.endsWith("_amount")) scaledDepth = depth / 5;
        else if (target.endsWith("_time")) scaledDepth = depth / 1000;
        else if (target.endsWith("_rate")) scaledDepth = depth / 20;
        lfoNodes.gain.gain.setTargetAtTime(scaledDepth, time, 0.05);
        if (lfoNodes.target !== target) {
          lfoNodes.gain.disconnect();
          this._connectGroupLfo(lfoNodes.gain, target, nodes);
          lfoNodes.target = target;
        }
      } else {
        let osc;
        if (["sine", "square", "sawtooth", "triangle"].includes(type)) {
          osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.value = freq;
        } else {
          const waveTable = lfo.waveTable || DEFAULT_SINE_TABLE;
          const buffer = ctx.createBuffer(1, waveTable.length, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < waveTable.length; i++) data[i] = waveTable[i];
          osc = ctx.createBufferSource();
          osc.buffer = buffer;
          osc.loop = true;
          const baseRate = ctx.sampleRate / waveTable.length;
          osc.playbackRate.value = freq / baseRate;
        }
        const gain = ctx.createGain();
        let scaledDepth = depth;
        if (target === "volume") scaledDepth = depth / 100;
        else if (target === "pitch") scaledDepth = depth * 10;
        else if (target === "lfoMult" || target === "envMult")
          scaledDepth = depth / 100;
        else if (target.endsWith("_frequency")) scaledDepth = depth * 50;
        else if (target.endsWith("_gain")) scaledDepth = depth * 1.5;
        else if (
          target.endsWith("_mix") ||
          target.endsWith("_feedback") ||
          target.endsWith("_depth")
        )
          scaledDepth = depth / 100;
        else if (target.endsWith("_q")) scaledDepth = depth / 10;
        else if (target.endsWith("_amount")) scaledDepth = depth / 5;
        else if (target.endsWith("_time")) scaledDepth = depth / 1000;
        else if (target.endsWith("_rate")) scaledDepth = depth / 20;
        gain.gain.value = scaledDepth;
        osc.connect(gain);
        this._connectGroupLfo(gain, target, nodes);
        if (osc.start) osc.start(time);
        nodes.lfos.set(lfo.id, { osc, gain, target });
      }
    });
    this.activeNodes.forEach((node, nodeKey) => {
      // nodeKey is either sourceId or sourceId_groupId
      const sourceId = node.config ? node.config.id : nodeKey.split("_")[0];
      const config = this.sourceConfigs.get(sourceId);
      if (config) {
        const gids =
          config.groupIds && config.groupIds.length > 0
            ? config.groupIds
            : config.groupId
              ? [config.groupId]
              : [];
        if (gids.includes(group.id)) {
          this.updateSourceParams(config);
        }
      }
    });
  }

  _connectGroupLfo(gainNode, target, groupNodes) {
    if (target === "volume") {
      gainNode.connect(groupNodes.groupControlSum);
    } else if (target === "pitch") {
      gainNode.connect(groupNodes.groupPitchModNode);
    } else if (target === "lfoMult") {
      gainNode.connect(groupNodes.groupLfoMultModNode);
    } else if (target === "envMult") {
      gainNode.connect(groupNodes.groupEnvMultModNode);
    } else if (target && target.startsWith("fx_")) {
      const body = target.slice(3);
      const li = body.lastIndexOf("_");
      if (li > 0) {
        const id = body.slice(0, li);
        const param = body.slice(li + 1);
        const inst = groupNodes.fxInstances && groupNodes.fxInstances.get(id);
        const pn = this._fxInstanceParamNode(inst, param);
        if (pn) gainNode.connect(pn);
      }
    }
  }

  _cleanupGroupNodes(nodes) {
    try {
      if (nodes.lfos) {
        nodes.lfos.forEach((lfo) => {
          try {
            lfo.osc.stop();
          } catch (e) {}
          try {
            lfo.osc.disconnect();
          } catch (e) {}
          try {
            lfo.gain.disconnect();
          } catch (e) {}
        });
        nodes.lfos.clear();
      }
      if (nodes.groupGain) nodes.groupGain.disconnect();
      if (nodes.groupMuteGain) nodes.groupMuteGain.disconnect();
      if (nodes.groupVolModGain) nodes.groupVolModGain.disconnect();
      if (nodes.groupControlBias) {
        try {
          nodes.groupControlBias.stop();
        } catch (e) {}
        nodes.groupControlBias.disconnect();
      }
      if (nodes.groupControlSum) nodes.groupControlSum.disconnect();
      if (nodes.groupControlScale) nodes.groupControlScale.disconnect();
      if (nodes.groupWaveshaper) nodes.groupWaveshaper.disconnect();
      if (nodes.groupMultiplierGain) nodes.groupMultiplierGain.disconnect();
      if (nodes.groupPitchModNode) nodes.groupPitchModNode.disconnect();
      if (nodes.groupLfoMultModNode) nodes.groupLfoMultModNode.disconnect();
      if (nodes.groupEnvMultModNode) nodes.groupEnvMultModNode.disconnect();

      // Cleanup dynamic FX chain instances
      if (nodes.fxInstances) {
        nodes.fxInstances.forEach((inst) => this._disposeFxInstance(inst));
        nodes.fxInstances.clear();
      }
    } catch (e) {
      console.warn("Error cleaning up group nodes:", e);
    }
  }
  deleteGroup(groupId) {
    const nodes = this.groupNodes.get(groupId);
    if (nodes) {
      this._cleanupGroupNodes(nodes);
      this.groupNodes.delete(groupId);
    }
    this.groupsConfig.delete(groupId);
  }
  setGlobalEnvelopeMultiplier(f) {
    this.globalEnvelopeMultiplier = Math.max(0.01, f);
  }
  restartSource(f) {
    // Stop all group instances, then respawn
    const keysToDelete = [];
    this.activeNodes.forEach((node, key) => {
      if (key === f || key.startsWith(f + "_")) {
        this._cleanupNodes(node);
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((k) => this.activeNodes.delete(k));
    if (this.isGlobalPlaying) {
      const cfg = this.sourceConfigs.get(f);
      if (cfg) {
        const allGids =
          cfg.groupIds && cfg.groupIds.length > 0
            ? cfg.groupIds
            : cfg.groupId
              ? [cfg.groupId]
              : [null];
        allGids.forEach((gid) => this._playOneShotG(f, gid, 0, null));
      }
    }
  }
  stopSource(f) {
    // Stop all group instances for this source
    const keysToDelete = [];
    this.activeNodes.forEach((node, key) => {
      if (key === f || key.startsWith(f + "_")) {
        this._cleanupNodes(node);
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((k) => this.activeNodes.delete(k));
  }
  playSource(f) {
    this.sourceConfigs.set(f.id, f);
    this.isGlobalPlaying = true;
    const cfg = this.sourceConfigs.get(f.id);
    if (!cfg) return;
    const allGids =
      cfg.groupIds && cfg.groupIds.length > 0
        ? cfg.groupIds
        : cfg.groupId
          ? [cfg.groupId]
          : [null];
    // For multi-group: spawn independent chain for each group
    allGids.forEach((gid) => {
      const key = f.id + (gid ? "_" + gid : "");
      if (!this.activeNodes.has(key)) this._playOneShotG(f.id, gid, 0, null);
    });
  }
  _playOneShot(f, x = 0, o = null) {
    // Legacy single-group dispatch - used for loop continuation
    const cfg = this.sourceConfigs.get(f);
    if (!cfg || !cfg.isPlaying) return;
    const allGids =
      cfg.groupIds && cfg.groupIds.length > 0
        ? cfg.groupIds
        : cfg.groupId
          ? [cfg.groupId]
          : [null];
    allGids.forEach((gid) => this._playOneShotG(f, gid, x, o));
  }
  _playOneShotG(f, activeGroupId, x = 0, o = null) {
    const g = this.sourceConfigs.get(f);
    if (!g || !g.isPlaying) return;
    const T = this.getContext(),
      Q = T.currentTime,
      R = g.globalPitch || 1,
      O = g.globalLfoPitch || 1;
    const grConfig = activeGroupId
      ? this.groupsConfig.get(activeGroupId)
      : null;
    const grPitch = grConfig ? (grConfig.pitch ?? 1) : 1;
    const grLfoMult = grConfig ? (grConfig.lfoMult ?? 1) : 1;
    let grEnvMult = grConfig ? (grConfig.envMult ?? 1) : 1;
    if (grConfig && grConfig.lfos) {
      grConfig.lfos.forEach((l) => {
        if (l.active && l.target === "envMult") {
          grEnvMult += this._getLfoValueAtTime(l, Q);
        }
      });
    }
    let masterEnvMult = this.globalEnvelopeMultiplier;
    if (this.masterLfosConfig) {
      this.masterLfosConfig.forEach((l) => {
        if (l.enabled && l.target === "envMult") {
          masterEnvMult += this._getLfoValueAtTime(l, Q);
        }
      });
    }
    let A = null,
      isSample = false,
      sampleStartOffset = 0,
      sampleDuration = 0,
      sampleRealDuration = 0;
    if (g.type === "basic") {
      if (g.oscType === "custom") {
        const y = T.createBuffer(1, g.waveTable.length, T.sampleRate),
          d = y.getChannelData(0);
        for (let $ = 0; $ < g.waveTable.length; $++) d[$] = g.waveTable[$];
        const p = T.createBufferSource();
        ((p.buffer = y), (p.loop = !0));
        const Y = T.sampleRate / g.waveTable.length;
        ((p.playbackRate.value = (g.frequency / Y) * R * grPitch), (A = p));
      } else {
        const y = T.createOscillator();
        ((y.type = g.oscType),
          (y.frequency.value = g.frequency * R * grPitch),
          (y.detune.value = g.detune),
          (A = y));
      }
    } else if (g.type === "drawable") {
      const y = T.createBuffer(1, g.waveTable.length, T.sampleRate),
        d = y.getChannelData(0);
      for (let $ = 0; $ < g.waveTable.length; $++) d[$] = g.waveTable[$];
      const p = T.createBufferSource();
      ((p.buffer = y), (p.loop = !0));
      const Y = T.sampleRate / g.waveTable.length;
      ((p.playbackRate.value = (g.frequency / Y) * R * grPitch), (A = p));
    } else if (g.type === "sample" && g.audioBuffer) {
      isSample = true;
      const y = T.createBufferSource();
      let rate = 1;
      if (g.samplePlaybackMode === "pitch") {
        const pitchRatio = (g.frequency / 261.63) * R * grPitch,
          cacheKey = `${g.id}_${pitchRatio.toFixed(3)}`;
        let bufferToPlay = this.pitchShiftCache.get(cacheKey);
        (bufferToPlay ||
          ((bufferToPlay = pitchShiftBuffer(g.audioBuffer, T, pitchRatio)),
          this.pitchShiftCache.set(cacheKey, bufferToPlay)),
          (y.buffer = bufferToPlay),
          (rate = 1));
      } else {
        ((y.buffer = g.audioBuffer),
          (rate = (g.frequency / 261.63) * R * grPitch));
      }
      y.playbackRate.value = rate;
      sampleStartOffset = Math.max(0, g.sampleLoopStart || 0);
      const endOffset = Math.min(
        y.buffer.duration,
        g.sampleLoopEnd || y.buffer.duration,
      );
      sampleDuration = Math.max(0.01, endOffset - sampleStartOffset);
      sampleRealDuration = sampleDuration / rate;
      A = y;
    }
    if (!A) return;
    if (A.frequency) {
      if (this.masterPitchModNode) this.masterPitchModNode.connect(A.frequency);
      if (grConfig && activeGroupId) {
        const grNodes = this._getOrCreateGroupNodes(activeGroupId);
        if (grNodes.groupPitchModNode)
          grNodes.groupPitchModNode.connect(A.frequency);
      }
    } else if (A.playbackRate) {
      if (this.masterPitchModNode)
        this.masterPitchModNode.connect(A.playbackRate);
      if (grConfig && activeGroupId) {
        const grNodes = this._getOrCreateGroupNodes(activeGroupId);
        if (grNodes.groupPitchModNode)
          grNodes.groupPitchModNode.connect(A.playbackRate);
      }
    }
    const E = T.createGain();
    g.isEnvelopeBypassed
      ? E.gain.setValueAtTime(1, Q)
      : (E.gain.setValueAtTime(0, Q),
        [...g.envelope]
          .sort((d, p) => d.time - p.time)
          .forEach((d) => {
            const p =
              Q +
              d.time /
                Math.max(
                  0.01,
                  g.envelopeSpeedMultiplier * masterEnvMult * grEnvMult,
                );
            E.gain.linearRampToValueAtTime(d.value, p);
          }));
    const S = T.createStereoPanner(),
      _ = T.createGain(),
      le = T.createConstantSource();
    ((le.offset.value = 1), le.start(Q));
    const H = T.createGain(),
      X = T.createGain();
    X.gain.value = 0.1;
    const W = T.createWaveShaper(),
      I = 65536,
      me = new Float32Array(I);
    for (let y = 0; y < I; y++) {
      const d = (y / (I - 1)) * 2 - 1;
      me[y] = d < 0 ? 0 : d;
    }
    W.curve = me;
    const fe = T.createGain();
    ((fe.gain.value = 10),
      le.connect(H),
      H.connect(X),
      X.connect(W),
      W.connect(fe),
      fe.connect(_.gain),
      (_.gain.value = 0));
    const oe = T.createGain(),
      Ee = T.createGain();
    ((S.pan.value = g.pan), (oe.gain.value = g.volume));
    const isSourceSolo = g.isSolo;
    const isGroupSolo = grConfig ? grConfig.isSolo : false;
    const isSoloActive = this.isSoloMode;
    // Check solo/mute for this specific group instance
    const groupMuted = grConfig ? grConfig.isMuted : false;
    const Ce =
      (isSoloActive && !isSourceSolo && !isGroupSolo) ||
      g.isMuted ||
      groupMuted;
    Ee.gain.value = Ce ? 0 : 1;
    let te = [];
    x === 0 || !o
      ? g.lfos &&
        g.lfos.forEach((y, d) => {
          if (!y.active || g.isLfoBypassed) return;
          let p = null;
          if (["sine", "square", "sawtooth", "triangle"].includes(y.type)) {
            p = T.createOscillator();
            y.phase && y.phase !== 0
              ? p.setPeriodicWave(
                  createPeriodicWaveWithPhase(T, y.type, y.phase),
                )
              : (p.type = y.type);
            p.frequency.value = y.frequency * O * grLfoMult;
          } else {
            const h = T.createBuffer(1, y.waveTable.length, T.sampleRate),
              D = h.getChannelData(0);
            for (let k = 0; k < D.length; k++) D[k] = y.waveTable[k];
            ((p = T.createBufferSource()), (p.buffer = h), (p.loop = !0));
            const K = T.sampleRate / D.length;
            if (
              ((p.playbackRate.value = (y.frequency / K) * O * grLfoMult),
              y.phase && y.phase !== 0)
            ) {
              const k = (y.phase / 360) * h.duration;
              p.start(Q, k % h.duration);
            } else p.start(Q);
          }
          if (p.frequency) {
            if (this.masterLfoMultModNode)
              this.masterLfoMultModNode.connect(p.frequency);
            if (grConfig && activeGroupId) {
              const grNodes = this._getOrCreateGroupNodes(activeGroupId);
              if (grNodes.groupLfoMultModNode)
                grNodes.groupLfoMultModNode.connect(p.frequency);
            }
          } else if (p.playbackRate) {
            if (this.masterLfoMultModNode)
              this.masterLfoMultModNode.connect(p.playbackRate);
            if (grConfig && activeGroupId) {
              const grNodes = this._getOrCreateGroupNodes(activeGroupId);
              if (grNodes.groupLfoMultModNode)
                grNodes.groupLfoMultModNode.connect(p.playbackRate);
            }
          }
          let Y = p;
          if (y.type === "square" || y.type === "sawtooth") {
            const h = T.createBiquadFilter();
            ((h.type = "lowpass"),
              (h.frequency.value = 70),
              (h.Q.value = 0.5),
              p.connect(h),
              (Y = h));
          }
          const $ = T.createGain();
          let ce = y.depth;
          if (y.target === "volume" || y.target === "pan") ce = ce / 100;
          else if (y.target === "frequency")
            ce = g.type === "basic" ? ce * 10 : ce / 50;
          else if (
            y.target.startsWith("lfo_") &&
            y.target.endsWith("_frequency")
          )
            ce = ce * 0.3;
          else if (y.target.startsWith("lfo_") && y.target.endsWith("_depth"))
            ce = ce / 100;
          (($.gain.value = ce), Y.connect($));
          (y.type === "sine" ||
            y.type === "square" ||
            y.type === "sawtooth" ||
            y.type === "triangle") &&
            p.start(Q);
          te.push({ osc: p, gain: $, currentTarget: y.target, configIndex: d });
        })
      : (te = o);
    (A.connect(E), E.connect(S));
    let ne = S;
    const q = [];
    let j = [];
    g.eq && (Array.isArray(g.eq) ? (j = g.eq) : g.eq.enabled && (j = [g.eq]));
    j.forEach((y, d) => {
      const p = T.createBiquadFilter();
      ((p.type = y.type || "peaking"),
        (p.frequency.value = y.frequency || 1e3),
        (p.Q.value = y.q || 1),
        (p.gain.value = y.gain || 0));
      y.enabled && (ne.connect(p), (ne = p));
      q.push(p);
    });
    // Single-group routing for this independent chain instance
    if (!activeGroupId) {
      (ne.connect(_),
        _.connect(oe),
        oe.connect(Ee),
        Ee.connect(this.globalGain));
    } else {
      const grNodes = this._getOrCreateGroupNodes(activeGroupId);
      (ne.connect(_),
        _.connect(oe),
        oe.connect(Ee),
        Ee.connect(grNodes.groupVolModGain));
    }
    te.forEach((y) => {
      try {
        y.gain.disconnect();
      } catch {}
    });
    let F = 0;
    g.lfos &&
      g.lfos.forEach((y) => {
        if (!y.active || g.isLfoBypassed || F >= te.length) return;
        const p = te[F].gain;
        if (y.target === "volume") p.connect(H);
        else if (y.target === "pan") p.connect(S.pan);
        else if (y.target === "frequency")
          A.frequency
            ? p.connect(A.frequency)
            : A.playbackRate &&
              (g.type !== "sample" || y.rateMod) &&
              p.connect(A.playbackRate);
        else if (y.target.startsWith("eq_")) {
          const Y = y.target.split("_"),
            $ = parseInt(Y[1]),
            ce = Y[2];
          if (q[$]) {
            const h = q[$];
            ce === "frequency"
              ? p.connect(h.frequency)
              : ce === "q"
                ? p.connect(h.Q)
                : ce === "gain" && p.connect(h.gain);
          }
        } else if (y.target.startsWith("lfo_")) {
          const Y = y.target.split("_"),
            $ = parseInt(Y[1]),
            ce = Y[2];
          if (te[$]) {
            const h = te[$];
            ce === "frequency"
              ? h.osc.frequency
                ? p.connect(h.osc.frequency)
                : h.osc.playbackRate && p.connect(h.osc.playbackRate)
              : ce === "depth" && p.connect(h.gain.gain);
          }
        }
        F++;
      });
    if (isSample) {
      A.start(Q, sampleStartOffset, sampleDuration);
      const fadeIn = Math.min(sampleRealDuration / 2, g.sampleFadeIn || 0),
        fadeOut = Math.min(sampleRealDuration / 2, g.sampleFadeOut || 0);
      if (fadeIn > 0 || fadeOut > 0) {
        E.gain.setValueAtTime(0, Q);
        if (fadeIn > 0) E.gain.linearRampToValueAtTime(1, Q + fadeIn);
        else E.gain.setValueAtTime(1, Q);
        if (fadeOut > 0) {
          E.gain.setValueAtTime(1, Q + sampleRealDuration - fadeOut);
          E.gain.linearRampToValueAtTime(0, Q + sampleRealDuration);
        }
      }
    } else {
      A.start(Q);
    }
    let M = 0;
    if (isSample) {
      M = sampleRealDuration;
    } else if (g.isEnvelopeBypassed) M = 2;
    else {
      const y = [...g.envelope].sort((d, p) => d.time - p.time);
      y.length > 0 &&
        (M =
          y[y.length - 1].time /
          Math.max(
            0.01,
            g.envelopeSpeedMultiplier * masterEnvMult * grEnvMult,
          ));
    }
    const V = Q + M + 0.05;
    (g.isLooping || isSample) && A.stop(V);
    const _nodeKey = f + (activeGroupId ? "_" + activeGroupId : "");
    A.onended = () => {
      const y = this.activeNodes.get(_nodeKey);
      if (y && y.source === A) {
        const d = this.sourceConfigs.get(f);
        if (!(d && d.isPlaying && d.isLooping)) this._cleanupNodes(y);
        else
          try {
            y.source && ((y.source.onended = null), y.source.disconnect());
            y.gain && y.gain.disconnect();
            y.panner && y.panner.disconnect();
            y.eqNodes &&
              y.eqNodes.forEach((Y) => {
                try {
                  Y.disconnect();
                } catch {}
              });
            y.modulationGain && y.modulationGain.disconnect();
            y.masterGain && y.masterGain.disconnect();
            y.muteGain && y.muteGain.disconnect();
          } catch {}
        this.activeNodes.delete(_nodeKey);
      }
      const d = this.sourceConfigs.get(f);
      if (d && d.isPlaying && d.isLooping) {
        const p = Math.max(1, d.loopCount || 1),
          Y = (x + 1) % p;
        this._playOneShotG(f, activeGroupId, Y, te);
      }
    };
    const nodeKey = f + (activeGroupId ? "_" + activeGroupId : "");
    this.activeNodes.set(nodeKey, {
      source: A,
      gain: E,
      panner: S,
      eqNodes: q,
      modulationGain: _,
      controlBias: le,
      controlSum: H,
      masterGain: oe,
      muteGain: Ee,
      lfos: te,
      startTime: Q,
      config: g,
      loopIndex: x,
      groupId: activeGroupId,
    });
  }
  async decodeAudio(f) {
    const x = this.getContext(),
      o = await f.arrayBuffer();
    return await x.decodeAudioData(o);
  }
}
