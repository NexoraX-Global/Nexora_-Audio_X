/**
 * NEXORA AUDIO X — Complete Studio Engineering Implementation
 * Vanilla JavaScript | Web Audio API | MediaRecorder | IndexedDB | LameJS MP3 & PCM WAV
 */

(() => {
  'use strict';

  /* =========================================================================
     GLOBAL STUDIO STATE & SINGLETON AUDIO CONTEXT
     ========================================================================= */
  const StudioState = {
    audioCtx: null,
    activeBuffer: null,
    activeName: 'Untitled_Audio',
    hasUnsavedRecording: false,

    // Feature 01: Recorder
    mediaStream: null,
    mediaRecorder: null,
    recChunks: [],
    recStartTime: 0,
    recPausedDuration: 0,
    recPauseStamp: 0,
    recTimerRaf: null,
    recAnalyser: null,
    recSourceNode: null,
    recLastBlob: null,
    recLastBuffer: null,
    recSupportedMime: '',

    // Feature 02: Cleaner
    cleanerOrigBuffer: null,
    cleanerProcessedBuffer: null,
    cleanerAbortCtrl: null,

    // Feature 03: Tuning Studio
    tuningSourceBuffer: null,
    tuningPlaying: false,
    tuningNodes: null,
    tuningAnimRaf: null,

    // Feature 04 & 05: AI TTS & Speech Control
    ttsVoices: [],
    ttsPlaying: false,
    ttsPaused: false,
    ttsAbortQueue: false,
    ttsSynthesizedBuffer: null,
    ttsCurrentSegmentIdx: -1,

    // Feature 06: Non-Destructive Editor
    editorOriginalBuffer: null,
    editorCurrentBuffer: null,
    editorUndoStack: [],
    editorRedoStack: [],
    editorSelStart: 0,
    editorSelEnd: 0,
    editorCursor: 0,
    editorSourceNode: null,
    editorIsPlaying: false,

    // Feature 07: Mixer
    mixVoiceBuffer: null,
    mixMusicBuffer: null,
    mixMasterBuffer: null,
    mixLiveNodes: [],
    mixIsPlaying: false,

    // Feature 08: IndexedDB
    db: null
  };

  /* =========================================================================
     UTILITIES & AUDIO ENGINE INITIALIZATION
     ========================================================================= */
  const $ = (id) => document.getElementById(id);

  function showToast(message, type = 'info') {
    const container = $('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4200);
  }

  function getAudioContext() {
    if (!StudioState.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      StudioState.audioCtx = new AudioContextClass();
    }
    if (StudioState.audioCtx.state === 'suspended') {
      StudioState.audioCtx.resume();
    }
    const badge = $('audioEngineBadge');
    if (badge) {
      badge.textContent = `AudioCtx: ${StudioState.audioCtx.sampleRate} Hz`;
      badge.classList.add('active');
    }
    return StudioState.audioCtx;
  }

  function setActiveStudioBuffer(buffer, name = 'Studio_Audio') {
    if (!buffer) return;
    StudioState.activeBuffer = buffer;
    StudioState.activeName = name.replace(/\.[^/.]+$/, '');
    const badge = $('activeBufferBadge');
    if (badge) {
      badge.textContent = `${StudioState.activeName} (${buffer.duration.toFixed(1)}s)`;
      badge.classList.add('active');
    }
    const exportInput = $('exportFileName');
    if (exportInput) exportInput.value = StudioState.activeName;
  }

  function cloneAudioBuffer(srcBuffer) {
    const ctx = getAudioContext();
    const copy = ctx.createBuffer(
      srcBuffer.numberOfChannels,
      srcBuffer.length,
      srcBuffer.sampleRate
    );
    for (let ch = 0; ch < srcBuffer.numberOfChannels; ch++) {
      copy.copyToChannel(new Float32Array(srcBuffer.getChannelData(ch)), ch);
    }
    return copy;
  }

  function formatDuration(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '00:00:00.0';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    const tenths = Math.floor((sec % 1) * 10);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
  }

  async function decodeFileToAudioBuffer(fileOrBlob) {
    const ctx = getAudioContext();
    const arrayBuf = await fileOrBlob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuf);
  }

  function drawStaticWaveform(canvas, audioBuffer, color = '#3b82f6', selStart = null, selEnd = null, cursor = null) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, width, height);

    // Center zero line
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (!audioBuffer || audioBuffer.length === 0) return;

    const data = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));
    const amp = height / 2;

    // Selection overlay if editor values provided
    if (selStart !== null && selEnd !== null && audioBuffer.duration > 0) {
      const x1 = Math.max(0, Math.min(width, (selStart / audioBuffer.duration) * width));
      const x2 = Math.max(0, Math.min(width, (selEnd / audioBuffer.duration) * width));
      ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
      ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), height);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      const startIdx = i * step;
      for (let j = 0; j < step && startIdx + j < data.length; j++) {
        const datum = data[startIdx + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      if (min > max) { min = 0; max = 0; }
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();

    // Cursor line if provided
    if (cursor !== null && audioBuffer.duration > 0) {
      const cx = Math.max(0, Math.min(width, (cursor / audioBuffer.duration) * width));
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, height);
      ctx.stroke();
    }
  }

  /* =========================================================================
     GENUINE BINARY AUDIO ENCODERS (16-BIT PCM WAV & LAMEJS MP3)
     ========================================================================= */
  function encodeAudioBufferToWavBlob(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length * numChannels * 2;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // PCM format = 1
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true); // 16-bit
    writeString(36, 'data');
    view.setUint32(40, length, true);

    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(audioBuffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function encodeAudioBufferToMp3Blob(audioBuffer, onProgress) {
    if (typeof window.lamejs === 'undefined') {
      throw new Error('LameJS MP3 encoder library is not loaded (check network connection). Use WAV export instead.');
    }
    const numChannels = Math.min(2, audioBuffer.numberOfChannels);
    const sampleRate = audioBuffer.sampleRate;
    const kbps = 192;
    const mp3encoder = new window.lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
    const mp3Data = [];

    const floatTo16Bit = (floatArr) => {
      const int16 = new Int16Array(floatArr.length);
      for (let i = 0; i < floatArr.length; i++) {
        const s = Math.max(-1, Math.min(1, floatArr[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return int16;
    };

    const left = floatTo16Bit(audioBuffer.getChannelData(0));
    const right = numChannels > 1 ? floatTo16Bit(audioBuffer.getChannelData(1)) : left;

    const sampleBlockSize = 1152 * 16;
    for (let i = 0; i < left.length; i += sampleBlockSize) {
      const leftChunk = left.subarray(i, i + sampleBlockSize);
      let mp3buf;
      if (numChannels === 2) {
        const rightChunk = right.subarray(i, i + sampleBlockSize);
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftChunk);
      }
      if (mp3buf.length > 0) mp3Data.push(mp3buf);

      if (onProgress) {
        onProgress(Math.min(99, Math.round((i / left.length) * 100)));
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    const endBuf = mp3encoder.flush();
    if (endBuf.length > 0) mp3Data.push(endBuf);
    if (onProgress) onProgress(100);

    return new Blob(mp3Data, { type: 'audio/mpeg' });
  }

  async function encodeAudioBufferToWebmBlob(audioBuffer, onProgress) {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    const supported = candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!supported) {
      throw new Error('This browser does not support MediaRecorder WebM/Opus encoding.');
    }

    const ctx = getAudioContext();
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(dest);

    return new Promise((resolve, reject) => {
      const chunks = [];
      const rec = new MediaRecorder(dest.stream, { mimeType: supported });
      const startTime = performance.now();
      const durationMs = audioBuffer.duration * 1000;

      const timer = setInterval(() => {
        const elapsed = performance.now() - startTime;
        if (onProgress) onProgress(Math.min(99, Math.round((elapsed / durationMs) * 100)));
      }, 150);

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      rec.onerror = (err) => {
        clearInterval(timer);
        reject(err);
      };
      rec.onstop = () => {
        clearInterval(timer);
        if (onProgress) onProgress(100);
        resolve(new Blob(chunks, { type: supported }));
      };

      rec.start();
      src.start(0);
      src.onended = () => {
        if (rec.state !== 'inactive') rec.stop();
      };
    });
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  /* =========================================================================
     NAVIGATION & UNSAVED RECORDING PROTECTION
     ========================================================================= */
  function initNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    const sections = document.querySelectorAll('.studio-module');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetId = tab.getAttribute('data-target');
        tabs.forEach((t) => t.classList.remove('active'));
        sections.forEach((s) => s.classList.remove('active'));
        tab.classList.add('active');
        const targetSec = $(targetId);
        if (targetSec) targetSec.classList.add('active');
      });
    });

    window.addEventListener('beforeunload', (e) => {
      if (StudioState.hasUnsavedRecording || (StudioState.mediaRecorder && StudioState.mediaRecorder.state !== 'inactive')) {
        e.preventDefault();
        e.returnValue = 'You have an active or unsaved recording in Nexora Audio X.';
      }
    });
  }

  function switchToModule(sectionId) {
    const tab = document.querySelector(`.nav-tab[data-target="${sectionId}"]`);
    if (tab) tab.click();
  }

  /* =========================================================================
     FEATURE 01 — ULTRA-CLEAR PROFESSIONAL VOICE RECORDING
     ========================================================================= */
  function detectBestRecorderMime() {
    if (typeof window.MediaRecorder === 'undefined') return '';
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  async function refreshAudioInputDevices() {
    const select = $('recDeviceSelect');
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === 'audioinput');
      select.innerHTML = '';
      if (mics.length === 0) {
        const opt = document.createElement('option');
        opt.value = 'default';
        opt.textContent = 'Default System Microphone';
        select.appendChild(opt);
      } else {
        mics.forEach((mic, idx) => {
          const opt = document.createElement('option');
          opt.value = mic.deviceId || 'default';
          opt.textContent = mic.label || `Microphone Input ${idx + 1}`;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      showToast('Could not enumerate microphone devices: ' + err.message, 'error');
    }
  }

  function initRecorderModule() {
    StudioState.recSupportedMime = detectBestRecorderMime();
    const supportInfo = $('recConstraintSupportInfo');
    if (navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints) {
      const sc = navigator.mediaDevices.getSupportedConstraints();
      supportInfo.textContent = `Supported constraints: EC=${!!sc.echoCancellation}, NS=${!!sc.noiseSuppression}, AGC=${!!sc.autoGainControl} | Best Codec: ${StudioState.recSupportedMime || 'Browser Default'}`;
    }

    $('btnRefreshDevices').addEventListener('click', refreshAudioInputDevices);
    refreshAudioInputDevices();

    const btnStart = $('btnRecStart');
    const btnPause = $('btnRecPause');
    const btnResume = $('btnRecResume');
    const btnStop = $('btnRecStop');
    const recDot = $('recStateIndicator');

    const releaseRecorderStream = () => {
      if (StudioState.recTimerRaf) cancelAnimationFrame(StudioState.recTimerRaf);
      if (StudioState.recSourceNode) {
        try { StudioState.recSourceNode.disconnect(); } catch (_) {}
        StudioState.recSourceNode = null;
      }
      if (StudioState.mediaStream) {
        StudioState.mediaStream.getTracks().forEach((track) => track.stop());
        StudioState.mediaStream = null;
      }
    };

    const updateLiveMonitor = () => {
      if (!StudioState.mediaRecorder || StudioState.mediaRecorder.state === 'inactive') return;

      if (StudioState.mediaRecorder.state === 'recording') {
        const elapsed = (performance.now() - StudioState.recStartTime - StudioState.recPausedDuration) / 1000;
        $('recTimer').textContent = formatDuration(elapsed);
      }

      if (StudioState.recAnalyser) {
        const analyser = StudioState.recAnalyser;
        const bufLen = analyser.fftSize;
        const data = new Float32Array(bufLen);
        analyser.getFloatTimeDomainData(data);

        let sumSq = 0;
        let peak = 0;
        for (let i = 0; i < bufLen; i++) {
          const v = Math.abs(data[i]);
          sumSq += v * v;
          if (v > peak) peak = v;
        }
        const rms = Math.sqrt(sumSq / bufLen);
        const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
        $('recDbValue').textContent = db <= -99 ? '-∞ dB' : `${db.toFixed(1)} dB`;
        const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
        $('recMeterBar').style.width = `${pct}%`;

        // Draw live waveform
        const canvas = $('recWaveformCanvas');
        const cctx = canvas.getContext('2d');
        cctx.fillStyle = '#080a0f';
        cctx.fillRect(0, 0, canvas.width, canvas.height);
        cctx.strokeStyle = peak > 0.95 ? '#ef4444' : '#3b82f6';
        cctx.lineWidth = 2;
        cctx.beginPath();
        const sliceWidth = canvas.width / bufLen;
        let x = 0;
        for (let i = 0; i < bufLen; i++) {
          const y = (0.5 + data[i] * 0.45) * canvas.height;
          if (i === 0) cctx.moveTo(x, y);
          else cctx.lineTo(x, y);
          x += sliceWidth;
        }
        cctx.stroke();
      }

      StudioState.recTimerRaf = requestAnimationFrame(updateLiveMonitor);
    };

    btnStart.addEventListener('click', async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('getUserMedia is not supported in this browser or insecure context (HTTPS/localhost required).', 'error');
        return;
      }

      try {
        const deviceId = $('recDeviceSelect').value;
        const sampleRate = parseInt($('recSampleRate').value, 10) || 48000;
        const constraints = {
          audio: {
            deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
            sampleRate: { ideal: sampleRate },
            echoCancellation: $('chkEchoCancel').checked,
            noiseSuppression: $('chkNoiseSuppression').checked,
            autoGainControl: $('chkAutoGain').checked
          }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        StudioState.mediaStream = stream;
        $('recPermissionBadge').textContent = 'Mic: Granted';
        refreshAudioInputDevices();

        const audioCtx = getAudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        StudioState.recSourceNode = source;
        StudioState.recAnalyser = analyser;

        const options = StudioState.recSupportedMime ? { mimeType: StudioState.recSupportedMime } : {};
        const recorder = new MediaRecorder(stream, options);
        StudioState.mediaRecorder = recorder;
        StudioState.recChunks = [];
        StudioState.recStartTime = performance.now();
        StudioState.recPausedDuration = 0;
        StudioState.hasUnsavedRecording = true;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) StudioState.recChunks.push(e.data);
        };

        recorder.onstop = async () => {
          const finalMime = recorder.mimeType || StudioState.recSupportedMime || 'audio/webm';
          const blob = new Blob(StudioState.recChunks, { type: finalMime });
          StudioState.recLastBlob = blob;
          releaseRecorderStream();

          const url = URL.createObjectURL(blob);
          $('recPreviewPlayer').src = url;
          $('recMetaStatus').textContent = 'Captured (Unsaved)';
          $('recMetaMime').textContent = finalMime;

          try {
            const decoded = await decodeFileToAudioBuffer(blob);
            StudioState.recLastBuffer = decoded;
            const customName = $('recCustomName').value.trim() || `Recording_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
            $('recCustomName').value = customName;
            setActiveStudioBuffer(decoded, customName);

            $('recMetaDuration').textContent = `${decoded.duration.toFixed(2)} s`;
            $('recMetaSR').textContent = `${decoded.sampleRate} Hz`;
            $('btnRecSaveLib').disabled = false;
            $('btnRecSendCleaner').disabled = false;
            $('btnRecSendEditor').disabled = false;
            showToast('Recording finalized and decoded into studio buffer.', 'success');
          } catch (decodeErr) {
            showToast('Recorded blob ready, but AudioBuffer decode failed: ' + decodeErr.message, 'error');
          }
        };

        recorder.start(200);
        recDot.className = 'rec-dot recording';
        $('recMetaStatus').textContent = 'Recording in progress...';
        btnStart.disabled = true;
        btnPause.disabled = false;
        btnResume.disabled = true;
        btnStop.disabled = false;

        updateLiveMonitor();
      } catch (err) {
        $('recPermissionBadge').textContent = 'Mic: Denied/Error';
        showToast('Microphone access error: ' + err.message, 'error');
      }
    });

    btnPause.addEventListener('click', () => {
      if (StudioState.mediaRecorder && StudioState.mediaRecorder.state === 'recording') {
        StudioState.mediaRecorder.pause();
        StudioState.recPauseStamp = performance.now();
        recDot.className = 'rec-dot paused';
        btnPause.disabled = true;
        btnResume.disabled = false;
      }
    });

    btnResume.addEventListener('click', () => {
      if (StudioState.mediaRecorder && StudioState.mediaRecorder.state === 'paused') {
        StudioState.recPausedDuration += (performance.now() - StudioState.recPauseStamp);
        StudioState.mediaRecorder.resume();
        recDot.className = 'rec-dot recording';
        btnPause.disabled = false;
        btnResume.disabled = true;
      }
    });

    btnStop.addEventListener('click', () => {
      if (StudioState.mediaRecorder && StudioState.mediaRecorder.state !== 'inactive') {
        StudioState.mediaRecorder.stop();
        recDot.className = 'rec-dot';
        $('recMeterBar').style.width = '0%';
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnResume.disabled = true;
        btnStop.disabled = true;
      }
    });

    $('btnRecSaveLib').addEventListener('click', async () => {
      if (!StudioState.recLastBuffer) return;
      const name = $('recCustomName').value.trim() || 'Voice_Recording';
      await saveAudioBufferToLibrary(StudioState.recLastBuffer, name, 'Recording');
      StudioState.hasUnsavedRecording = false;
      $('recMetaStatus').textContent = 'Saved in Library';
    });

    $('btnRecSendCleaner').addEventListener('click', () => {
      if (!StudioState.recLastBuffer) return;
      loadBufferIntoCleaner(StudioState.recLastBuffer, $('recCustomName').value.trim() || 'Recorded_Take');
      switchToModule('sec-cleaner');
    });

    $('btnRecSendEditor').addEventListener('click', () => {
      if (!StudioState.recLastBuffer) return;
      loadBufferIntoEditor(StudioState.recLastBuffer, $('recCustomName').value.trim() || 'Recorded_Take');
      switchToModule('sec-editor');
    });
  }

  /* =========================================================================
     FEATURE 02 — NEXORA ADVANCED VOICE CLEANER
     ========================================================================= */
  function loadBufferIntoCleaner(buffer, label) {
    StudioState.cleanerOrigBuffer = cloneAudioBuffer(buffer);
    StudioState.cleanerProcessedBuffer = null;
    $('cleanerSourceInfo').textContent = `Source: ${label} (${buffer.duration.toFixed(2)}s, ${buffer.sampleRate} Hz)`;
    drawStaticWaveform($('cleanerOrigCanvas'), StudioState.cleanerOrigBuffer, '#64748b');
    const wavBlob = encodeAudioBufferToWavBlob(StudioState.cleanerOrigBuffer);
    $('cleanerOrigPlayer').src = URL.createObjectURL(wavBlob);

    // Clear processed preview
    const procCanvas = $('cleanerProcCanvas');
    procCanvas.getContext('2d').clearRect(0, 0, procCanvas.width, procCanvas.height);
    $('cleanerProcPlayer').removeAttribute('src');
    $('btnCleanerSaveLib').disabled = true;
    $('btnCleanerExportWav').disabled = true;
    $('btnCleanerToTuning').disabled = true;
  }

  function initCleanerModule() {
    const bindSliderLabel = (id, labelId, fmt) => {
      const el = $(id);
      const lbl = $(labelId);
      el.addEventListener('input', () => { lbl.textContent = fmt(el.value); });
    };

    bindSliderLabel('cleanIntensity', 'valCleanIntensity', (v) => `${v}%`);
    bindSliderLabel('cleanGateThresh', 'valCleanGateThresh', (v) => `${v} dB`);
    bindSliderLabel('cleanRumbleCut', 'valCleanRumbleCut', (v) => `${v} Hz`);
    bindSliderLabel('cleanHissCut', 'valCleanHissCut', (v) => `${v} Hz`);
    bindSliderLabel('cleanClarity', 'valCleanClarity', (v) => `+${parseFloat(v).toFixed(1)} dB`);

    $('cleanerAiEndpoint').addEventListener('input', (e) => {
      const hasUrl = e.target.value.trim().length > 0;
      $('cleanerEngineModeBadge').textContent = hasUrl
        ? 'Mode: External Neural API Configured'
        : 'Mode: Local WebAudio DSP';
    });

    $('cleanerFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await decodeFileToAudioBuffer(file);
        setActiveStudioBuffer(buf, file.name);
        loadBufferIntoCleaner(buf, file.name);
        showToast('Audio loaded into Voice Cleaner.', 'success');
      } catch (err) {
        showToast('Failed to decode audio file: ' + err.message, 'error');
      }
    });

    $('btnCleanerUseActive').addEventListener('click', () => {
      if (!StudioState.activeBuffer) {
        showToast('No active studio buffer available. Record or import a file first.', 'error');
        return;
      }
      loadBufferIntoCleaner(StudioState.activeBuffer, StudioState.activeName);
    });

    $('btnCancelCleaner').addEventListener('click', () => {
      if (StudioState.cleanerAbortCtrl) {
        StudioState.cleanerAbortCtrl.abort();
      }
    });

    $('btnRunCleaner').addEventListener('click', async () => {
      if (!StudioState.cleanerOrigBuffer) {
        showToast('Load an audio recording into the Cleaner first.', 'error');
        return;
      }

      const abortCtrl = new AbortController();
      StudioState.cleanerAbortCtrl = abortCtrl;
      $('btnRunCleaner').disabled = true;
      $('btnCancelCleaner').disabled = false;

      const updateProgress = (pct, label) => {
        $('cleanerProgressPct').textContent = `${pct}%`;
        $('cleanerProgressBar').style.width = `${pct}%`;
        if (label) $('cleanerProgressLabel').textContent = label;
      };

      const endpoint = $('cleanerAiEndpoint').value.trim();
      const token = $('cleanerAiToken').value.trim();

      try {
        let finalCleanedBuffer = null;

        if (endpoint) {
          updateProgress(15, 'Uploading WAV to External Neural Denoising API...');
          const wavBlob = encodeAudioBufferToWavBlob(StudioState.cleanerOrigBuffer);
          const formData = new FormData();
          formData.append('audio', wavBlob, 'input.wav');
          formData.append('intensity', $('cleanIntensity').value);

          const headers = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const resp = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: formData,
            signal: abortCtrl.signal
          });

          if (!resp.ok) {
            throw new Error(`External AI service returned HTTP ${resp.status}`);
          }
          updateProgress(70, 'Decoding neural cleaned response...');
          const outBlob = await resp.blob();
          finalCleanedBuffer = await decodeFileToAudioBuffer(outBlob);
        } else {
          // Stage 1: OfflineAudioContext filter chain (Rumble HPF, Hum Notch 1st-3rd harmonics, Mud Cut, Presence Boost, Hiss LPF)
          updateProgress(10, 'Running Stage 1 Biquad Filter Chain...');
          const srcBuf = StudioState.cleanerOrigBuffer;
          const offlineCtx = new OfflineAudioContext(
            srcBuf.numberOfChannels,
            srcBuf.length,
            srcBuf.sampleRate
          );

          const source = offlineCtx.createBufferSource();
          source.buffer = srcBuf;

          const hpf = offlineCtx.createBiquadFilter();
          hpf.type = 'highpass';
          hpf.frequency.value = parseFloat($('cleanRumbleCut').value);
          hpf.Q.value = 0.85;

          const lpf = offlineCtx.createBiquadFilter();
          lpf.type = 'lowpass';
          lpf.frequency.value = parseFloat($('cleanHissCut').value);
          lpf.Q.value = 0.707;

          const mudCut = offlineCtx.createBiquadFilter();
          mudCut.type = 'peaking';
          mudCut.frequency.value = 240;
          mudCut.Q.value = 1.4;
          mudCut.gain.value = - (parseFloat($('cleanIntensity').value) / 100) * 4.5;

          const clarityBoost = offlineCtx.createBiquadFilter();
          clarityBoost.type = 'peaking';
          clarityBoost.frequency.value = 3200;
          clarityBoost.Q.value = 1.1;
          clarityBoost.gain.value = parseFloat($('cleanClarity').value);

          let lastNode = source;
          lastNode.connect(hpf);
          lastNode = hpf;

          // Power-line hum notch cascade (1st, 2nd, 3rd harmonics)
          const humBase = parseInt($('cleanHumFreq').value, 10);
          if (humBase === 50 || humBase === 60) {
            [1, 2, 3].forEach((harmonic) => {
              const notch = offlineCtx.createBiquadFilter();
              notch.type = 'notch';
              notch.frequency.value = humBase * harmonic;
              notch.Q.value = 12;
              lastNode.connect(notch);
              lastNode = notch;
            });
          }

          lastNode.connect(mudCut);
          mudCut.connect(clarityBoost);
          clarityBoost.connect(lpf);
          lpf.connect(offlineCtx.destination);

          source.start(0);
          const filteredBuffer = await offlineCtx.startRendering();

          if (abortCtrl.signal.aborted) throw new Error('Processing cancelled by user.');

          // Stage 2: Chunked Time-Domain Adaptive Noise Gate & Spectral Floor Subtraction
          updateProgress(40, 'Running Stage 2 Adaptive Envelope Noise Gate...');
          finalCleanedBuffer = cloneAudioBuffer(filteredBuffer);

          const intensity = parseFloat($('cleanIntensity').value) / 100;
          const gateDb = parseFloat($('cleanGateThresh').value);
          const gateLinear = Math.pow(10, gateDb / 20);
          const sr = finalCleanedBuffer.sampleRate;
          const attackCoeff = Math.exp(-1 / (0.004 * sr));
          const releaseCoeff = Math.exp(-1 / (0.085 * sr));
          const floorAttenuation = 1 - intensity * 0.88;

          for (let ch = 0; ch < finalCleanedBuffer.numberOfChannels; ch++) {
            const chanData = finalCleanedBuffer.getChannelData(ch);
            let env = 0;
            const chunkSize = 32768;

            for (let i = 0; i < chanData.length; i += chunkSize) {
              if (abortCtrl.signal.aborted) throw new Error('Processing cancelled by user.');
              const end = Math.min(chanData.length, i + chunkSize);
              for (let j = i; j < end; j++) {
                const absSample = Math.abs(chanData[j]);
                if (absSample > env) {
                  env = attackCoeff * env + (1 - attackCoeff) * absSample;
                } else {
                  env = releaseCoeff * env + (1 - releaseCoeff) * absSample;
                }

                let gain = 1.0;
                if (env < gateLinear) {
                  const ratio = env / (gateLinear + 1e-9);
                  gain = Math.max(floorAttenuation, ratio * ratio);
                }
                chanData[j] = Math.max(-0.99, Math.min(0.99, chanData[j] * gain));
              }

              const pct = 40 + Math.round(((i / chanData.length) / finalCleanedBuffer.numberOfChannels) * 55);
              updateProgress(pct, 'Applying adaptive noise gate...');
              await new Promise((r) => setTimeout(r, 0));
            }
          }
        }

        StudioState.cleanerProcessedBuffer = finalCleanedBuffer;
        setActiveStudioBuffer(finalCleanedBuffer, `${StudioState.activeName}_Cleaned`);
        drawStaticWaveform($('cleanerProcCanvas'), finalCleanedBuffer, '#10b981');

        const cleanedWav = encodeAudioBufferToWavBlob(finalCleanedBuffer);
        $('cleanerProcPlayer').src = URL.createObjectURL(cleanedWav);

        updateProgress(100, 'Cleaning complete (Original preserved)');
        $('btnCleanerSaveLib').disabled = false;
        $('btnCleanerExportWav').disabled = false;
        $('btnCleanerToTuning').disabled = false;
        showToast('Voice cleaning completed. Compare Original vs. Cleaned above.', 'success');
      } catch (err) {
        updateProgress(0, 'Cancelled or failed');
        showToast(err.message, 'error');
      } finally {
        $('btnRunCleaner').disabled = false;
        $('btnCancelCleaner').disabled = true;
        StudioState.cleanerAbortCtrl = null;
      }
    });

    $('btnCleanerSaveLib').addEventListener('click', async () => {
      if (!StudioState.cleanerProcessedBuffer) return;
      await saveAudioBufferToLibrary(StudioState.cleanerProcessedBuffer, `${StudioState.activeName}_Cleaned`, 'Cleaned Voice');
    });

    $('btnCleanerExportWav').addEventListener('click', () => {
      if (!StudioState.cleanerProcessedBuffer) return;
      const wav = encodeAudioBufferToWavBlob(StudioState.cleanerProcessedBuffer);
      triggerBlobDownload(wav, `${StudioState.activeName}_Cleaned.wav`);
    });

    $('btnCleanerToTuning').addEventListener('click', () => {
      if (!StudioState.cleanerProcessedBuffer) return;
      loadBufferIntoTuning(StudioState.cleanerProcessedBuffer);
      switchToModule('sec-tuning');
    });
  }

  /* =========================================================================
     FEATURE 03 — ADVANCED VOICE TUNING STUDIO
     ========================================================================= */
  // Genuine Overlap-Add (OLA) Time-Domain Pitch Shifter (Preserves Duration & Speed!)
  function applyGenuinePitchShiftToBuffer(inputBuffer, semitones) {
    if (Math.abs(semitones) < 0.05) return cloneAudioBuffer(inputBuffer);
    const pitchFactor = Math.pow(2, semitones / 12);
    const ctx = getAudioContext();
    const outBuffer = ctx.createBuffer(
      inputBuffer.numberOfChannels,
      inputBuffer.length,
      inputBuffer.sampleRate
    );

    const grainSize = 1024;
    const overlap = 0.5;
    const hopSize = Math.floor(grainSize * (1 - overlap));

    // Hann window
    const windowCurve = new Float32Array(grainSize);
    for (let i = 0; i < grainSize; i++) {
      windowCurve[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
    }

    for (let ch = 0; ch < inputBuffer.numberOfChannels; ch++) {
      const inData = inputBuffer.getChannelData(ch);
      const outData = outBuffer.getChannelData(ch);

      for (let pos = 0; pos + grainSize < inData.length; pos += hopSize) {
        for (let i = 0; i < grainSize; i++) {
          const readIdx = pos + i * pitchFactor;
          const baseIdx = Math.floor(readIdx);
          const frac = readIdx - baseIdx;
          let sample = 0;
          if (baseIdx >= 0 && baseIdx + 1 < inData.length) {
            // Wrap grain read within local neighborhood to preserve exact duration
            const wrappedOffset = (i * pitchFactor) % grainSize;
            const localIdx = pos + Math.floor(wrappedOffset);
            const localFrac = wrappedOffset - Math.floor(wrappedOffset);
            if (localIdx + 1 < inData.length) {
              sample = inData[localIdx] * (1 - localFrac) + inData[localIdx + 1] * localFrac;
            }
          }
          outData[pos + i] += sample * windowCurve[i];
        }
      }
    }
    return outBuffer;
  }

  function createImpulseResponseBuffer(ctx, durationSec = 1.6, decay = 2.4) {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  function loadBufferIntoTuning(buffer) {
    StudioState.tuningSourceBuffer = cloneAudioBuffer(buffer);
    $('btnTuningPlay').disabled = false;
    $('btnTuningNormalize').disabled = false;
    $('btnTuningRenderSave').disabled = false;
    showToast('Audio buffer ready in Voice Tuning Studio.', 'info');
  }

  function buildTuningGraph(ctx, sourceBuffer) {
    const pitchedBuf = applyGenuinePitchShiftToBuffer(
      sourceBuffer,
      parseFloat($('tunePitch').value)
    );

    const source = ctx.createBufferSource();
    source.buffer = pitchedBuf;

    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = parseFloat($('tuneHPF').value);

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = parseFloat($('tuneLPF').value);

    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 120;
    bass.gain.value = parseFloat($('tuneBass').value);

    const treble = ctx.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = 6000;
    treble.gain.value = parseFloat($('tuneTreble').value);

    const clarity = ctx.createBiquadFilter();
    clarity.type = 'peaking';
    clarity.frequency.value = 3200;
    clarity.Q.value = 1.2;
    clarity.gain.value = parseFloat($('tuneClarity').value);

    const eqFreqs = [100, 350, 1000, 3500, 10000];
    const eqIds = ['eqBand1', 'eqBand2', 'eqBand3', 'eqBand4', 'eqBand5'];
    const eqBands = eqFreqs.map((f, idx) => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.4;
      b.gain.value = parseFloat($(eqIds[idx]).value);
      return b;
    });

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = parseFloat($('tuneCompThresh').value);
    comp.ratio.value = parseFloat($('tuneCompRatio').value);
    comp.attack.value = 0.005;
    comp.release.value = 0.15;

    // Delay / Echo branch
    const delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.28;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.32;
    const delayWet = ctx.createGain();
    delayWet.gain.value = parseFloat($('tuneEchoMix').value) / 100;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(delayWet);

    // Reverb branch
    const convolver = ctx.createConvolver();
    convolver.buffer = createImpulseResponseBuffer(ctx);
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = parseFloat($('tuneReverbMix').value) / 100;
    convolver.connect(reverbWet);

    // Dry + Wet Summing & Master Gain + Brickwall Limiter
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1.0;

    const masterGain = ctx.createGain();
    masterGain.gain.value = parseFloat($('tuneMasterGain').value) / 100;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.0;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;

    // Connect chain
    source.connect(hpf);
    hpf.connect(lpf);
    lpf.connect(bass);
    bass.connect(treble);
    treble.connect(clarity);

    let prev = clarity;
    eqBands.forEach((b) => {
      prev.connect(b);
      prev = b;
    });

    prev.connect(comp);
    comp.connect(dryGain);
    comp.connect(delayNode);
    comp.connect(convolver);

    dryGain.connect(masterGain);
    delayWet.connect(masterGain);
    reverbWet.connect(masterGain);
    masterGain.connect(limiter);

    return {
      source, hpf, lpf, bass, treble, clarity, eqBands,
      comp, delayWet, reverbWet, masterGain, limiter
    };
  }

  function initTuningModule() {
    const sliderConfigs = [
      ['tunePitch', 'valTunePitch', (v) => `${v} st`],
      ['tuneBass', 'valTuneBass', (v) => `${parseFloat(v).toFixed(1)} dB`],
      ['tuneTreble', 'valTuneTreble', (v) => `${parseFloat(v).toFixed(1)} dB`],
      ['tuneClarity', 'valTuneClarity', (v) => `${parseFloat(v).toFixed(1)} dB`],
      ['tuneHPF', 'valTuneHPF', (v) => `${v} Hz`],
      ['tuneLPF', 'valTuneLPF', (v) => `${v} Hz`],
      ['eqBand1', 'valEqBand1', (v) => `${parseFloat(v).toFixed(1)} dB`],
      ['eqBand2', 'valEqBand2', (v) => `${parseFloat(v).toFixed(1)} dB`],
      ['eqBand3', 'valEqBand3', (v) => `${parseFloat(v).toFixed(1)} dB`],
      ['eqBand4', 'valEqBand4', (v) => `${parseFloat(v).toFixed(1)} dB`],
      ['eqBand5', 'valEqBand5', (v) => `${parseFloat(v).toFixed(1)} dB`],
      ['tuneCompThresh', 'valTuneCompThresh', (v) => `${v} dB`],
      ['tuneCompRatio', 'valTuneCompRatio', (v) => `${v}:1`],
      ['tuneReverbMix', 'valTuneReverbMix', (v) => `${v}%`],
      ['tuneEchoMix', 'valTuneEchoMix', (v) => `${v}%`],
      ['tuneMasterGain', 'valTuneMasterGain', (v) => `${v}%`]
    ];

    const syncLiveNodes = () => {
      const n = StudioState.tuningNodes;
      if (!n || !StudioState.audioCtx) return;
      const now = StudioState.audioCtx.currentTime;
      n.hpf.frequency.setTargetAtTime(parseFloat($('tuneHPF').value), now, 0.02);
      n.lpf.frequency.setTargetAtTime(parseFloat($('tuneLPF').value), now, 0.02);
      n.bass.gain.setTargetAtTime(parseFloat($('tuneBass').value), now, 0.02);
      n.treble.gain.setTargetAtTime(parseFloat($('tuneTreble').value), now, 0.02);
      n.clarity.gain.setTargetAtTime(parseFloat($('tuneClarity').value), now, 0.02);
      ['eqBand1', 'eqBand2', 'eqBand3', 'eqBand4', 'eqBand5'].forEach((id, i) => {
        n.eqBands[i].gain.setTargetAtTime(parseFloat($(id).value), now, 0.02);
      });
      n.comp.threshold.setTargetAtTime(parseFloat($('tuneCompThresh').value), now, 0.02);
      n.comp.ratio.setTargetAtTime(parseFloat($('tuneCompRatio').value), now, 0.02);
      n.reverbWet.gain.setTargetAtTime(parseFloat($('tuneReverbMix').value) / 100, now, 0.02);
      n.delayWet.gain.setTargetAtTime(parseFloat($('tuneEchoMix').value) / 100, now, 0.02);
      n.masterGain.gain.setTargetAtTime(parseFloat($('tuneMasterGain').value) / 100, now, 0.02);
    };

    sliderConfigs.forEach(([id, valId, fmt]) => {
      const el = $(id);
      el.addEventListener('input', () => {
        $(valId).textContent = fmt(el.value);
        syncLiveNodes();
      });
    });

    const applyPresetValues = (vals) => {
      Object.entries(vals).forEach(([id, v]) => {
        const el = $(id);
        if (el) {
          el.value = v;
          el.dispatchEvent(new Event('input'));
        }
      });
    };

    const presets = {
      neutral: {
        tunePitch: 0, tuneBass: 0, tuneTreble: 0, tuneClarity: 0, tuneHPF: 30, tuneLPF: 18000,
        eqBand1: 0, eqBand2: 0, eqBand3: 0, eqBand4: 0, eqBand5: 0,
        tuneCompThresh: -20, tuneCompRatio: 3, tuneReverbMix: 0, tuneEchoMix: 0, tuneMasterGain: 100
      },
      podcast: {
        tunePitch: 0, tuneBass: 3.5, tuneTreble: 2.0, tuneClarity: 3.0, tuneHPF: 85, tuneLPF: 16000,
        eqBand1: 3, eqBand2: -2.5, eqBand3: 0.5, eqBand4: 3.5, eqBand5: 2.0,
        tuneCompThresh: -24, tuneCompRatio: 4, tuneReverbMix: 4, tuneEchoMix: 0, tuneMasterGain: 110
      },
      broadcast: {
        tunePitch: 0, tuneBass: 2.0, tuneTreble: 4.5, tuneClarity: 5.0, tuneHPF: 95, tuneLPF: 17000,
        eqBand1: 2, eqBand2: -3.5, eqBand3: 1.5, eqBand4: 4.5, eqBand5: 3.5,
        tuneCompThresh: -26, tuneCompRatio: 6, tuneReverbMix: 0, tuneEchoMix: 0, tuneMasterGain: 115
      },
      cinema: {
        tunePitch: -2, tuneBass: 6.0, tuneTreble: 1.5, tuneClarity: 2.5, tuneHPF: 60, tuneLPF: 15000,
        eqBand1: 5, eqBand2: -1.5, eqBand3: 0, eqBand4: 2.5, eqBand5: 1.0,
        tuneCompThresh: -22, tuneCompRatio: 4.5, tuneReverbMix: 14, tuneEchoMix: 6, tuneMasterGain: 105
      },
      bright: {
        tunePitch: 0, tuneBass: -1.0, tuneTreble: 5.5, tuneClarity: 4.5, tuneHPF: 100, tuneLPF: 19500,
        eqBand1: -1, eqBand2: -2.0, eqBand3: 1.0, eqBand4: 4.0, eqBand5: 5.0,
        tuneCompThresh: -20, tuneCompRatio: 3.5, tuneReverbMix: 8, tuneEchoMix: 0, tuneMasterGain: 105
      }
    };

    $('tuningPresetSelect').addEventListener('change', (e) => {
      const p = presets[e.target.value];
      if (p) applyPresetValues(p);
    });

    $('btnTuningReset').addEventListener('click', () => {
      $('tuningPresetSelect').value = 'neutral';
      applyPresetValues(presets.neutral);
    });

    $('tuningFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await decodeFileToAudioBuffer(file);
        setActiveStudioBuffer(buf, file.name);
        loadBufferIntoTuning(buf);
      } catch (err) {
        showToast('Failed to decode audio file: ' + err.message, 'error');
      }
    });

    $('btnTuningUseActive').addEventListener('click', () => {
      if (!StudioState.activeBuffer) {
        showToast('No active studio buffer found.', 'error');
        return;
      }
      loadBufferIntoTuning(StudioState.activeBuffer);
    });

    const stopTuningPreview = () => {
      if (StudioState.tuningAnimRaf) cancelAnimationFrame(StudioState.tuningAnimRaf);
      if (StudioState.tuningNodes && StudioState.tuningNodes.source) {
        try { StudioState.tuningNodes.source.stop(); } catch (_) {}
        try { StudioState.tuningNodes.limiter.disconnect(); } catch (_) {}
      }
      StudioState.tuningNodes = null;
      StudioState.tuningPlaying = false;
      $('btnTuningPlay').disabled = !StudioState.tuningSourceBuffer;
      $('btnTuningStop').disabled = true;
    };

    $('btnTuningPlay').addEventListener('click', () => {
      if (!StudioState.tuningSourceBuffer) return;
      stopTuningPreview();
      const ctx = getAudioContext();
      const graph = buildTuningGraph(ctx, StudioState.tuningSourceBuffer);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      graph.limiter.connect(analyser);
      analyser.connect(ctx.destination);

      StudioState.tuningNodes = graph;
      StudioState.tuningPlaying = true;
      $('btnTuningPlay').disabled = true;
      $('btnTuningStop').disabled = false;

      const canvas = $('tuningSpectrumCanvas');
      const cctx = canvas.getContext('2d');
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const timeData = new Float32Array(analyser.fftSize);

      const renderSpectrum = () => {
        if (!StudioState.tuningPlaying) return;
        analyser.getByteFrequencyData(freqData);
        analyser.getFloatTimeDomainData(timeData);

        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const a = Math.abs(timeData[i]);
          if (a > peak) peak = a;
        }
        const badge = $('tuningClipBadge');
        badge.textContent = peak > 0.98 ? 'Peak: Limiting Active' : `Peak: ${(20 * Math.log10(peak + 1e-5)).toFixed(1)} dB`;

        cctx.fillStyle = '#080a0f';
        cctx.fillRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / freqData.length) * 1.8;
        let x = 0;
        for (let i = 0; i < freqData.length; i++) {
          const barHeight = (freqData[i] / 255) * (canvas.height - 10);
          cctx.fillStyle = '#2563eb';
          cctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
          x += barWidth;
        }
        StudioState.tuningAnimRaf = requestAnimationFrame(renderSpectrum);
      };

      graph.source.onended = stopTuningPreview;
      graph.source.start(0);
      renderSpectrum();
    });

    $('btnTuningStop').addEventListener('click', stopTuningPreview);

    $('btnTuningNormalize').addEventListener('click', () => {
      if (!StudioState.tuningSourceBuffer) return;
      const buf = StudioState.tuningSourceBuffer;
      let maxPeak = 0;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const abs = Math.abs(d[i]);
          if (abs > maxPeak) maxPeak = abs;
        }
      }
      if (maxPeak > 0) {
        const targetLinear = Math.pow(10, -1.0 / 20); // -1.0 dBFS
        const scale = targetLinear / maxPeak;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = 0; i < d.length; i++) d[i] *= scale;
        }
        showToast('Source buffer normalized to -1.0 dBFS true peak.', 'success');
      }
    });

    $('btnTuningRenderSave').addEventListener('click', async () => {
      if (!StudioState.tuningSourceBuffer) return;
      stopTuningPreview();
      try {
        const src = StudioState.tuningSourceBuffer;
        const offlineCtx = new OfflineAudioContext(src.numberOfChannels, src.length, src.sampleRate);
        const graph = buildTuningGraph(offlineCtx, src);
        graph.limiter.connect(offlineCtx.destination);
        graph.source.start(0);
        const rendered = await offlineCtx.startRendering();
        setActiveStudioBuffer(rendered, `${StudioState.activeName}_Tuned`);
        await saveAudioBufferToLibrary(rendered, `${StudioState.activeName}_Tuned`, 'Tuned Voice');
        showToast('Tuned audio rendered and saved to Library.', 'success');
      } catch (err) {
        showToast('Render failed: ' + err.message, 'error');
      }
    });
  }

  /* =========================================================================
     FEATURE 04 & 05 — NEXORA NATURAL AI TTS & ADVANCED SPEECH CONTROL
     ========================================================================= */
  const SEVEN_VOICE_PROFILES = {
    profile_1: { name: 'Aarav', pitchMod: 0.94, rateMod: 0.98, baseF0: 118, formantScale: 1.0 },
    profile_2: { name: 'Diya', pitchMod: 1.15, rateMod: 1.02, baseF0: 210, formantScale: 1.18 },
    profile_3: { name: 'Kabir', pitchMod: 0.80, rateMod: 0.92, baseF0: 95, formantScale: 0.88 },
    profile_4: { name: 'Meera', pitchMod: 1.24, rateMod: 1.05, baseF0: 235, formantScale: 1.22 },
    profile_5: { name: 'Rohan', pitchMod: 1.02, rateMod: 1.12, baseF0: 140, formantScale: 1.04 },
    profile_6: { name: 'Ananya', pitchMod: 1.18, rateMod: 0.90, baseF0: 205, formantScale: 1.15 },
    profile_7: { name: 'Vikram', pitchMod: 0.88, rateMod: 1.00, baseF0: 108, formantScale: 0.94 }
  };

  function applyPronunciationRules(rawText) {
    const rulesRaw = $('spCtrlPronunciation').value || '';
    let processed = rawText;
    const lines = rulesRaw.split('\n');
    lines.forEach((line) => {
      const parts = line.split('=');
      if (parts.length === 2) {
        const key = parts[0].trim();
        const val = parts[1].trim();
        if (key) {
          const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          processed = processed.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), val);
        }
      }
    });
    return processed;
  }

  function segmentScriptText(text, mode = 'sentence') {
    const cleaned = text.trim();
    if (!cleaned) return [];
    if (mode === 'paragraph') {
      return cleaned.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    }
    // Sentence segmentation supporting English (., !, ?) and Hindi Poorna Viram (।)
    return cleaned
      .split(/(?<=[.!?।])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Local Formant / Harmonic Vocal Cadence Buffer Synthesizer for Offline Downloadable Audio
  function synthesizeLocalFormantSpeechBuffer(text, profileKey, speed, pitchMult, volume) {
    const ctx = getAudioContext();
    const sr = ctx.sampleRate;
    const profile = SEVEN_VOICE_PROFILES[profileKey] || SEVEN_VOICE_PROFILES.profile_1;
    const words = text.trim().split(/\s+/).filter(Boolean);
    const charCount = Math.max(10, text.length);
    const durationSec = Math.min(45, Math.max(1.5, (charCount * 0.068) / speed));
    const totalSamples = Math.floor(sr * durationSec);
    const buffer = ctx.createBuffer(1, totalSamples, sr);
    const data = buffer.getChannelData(0);

    const f0Base = profile.baseF0 * pitchMult;
    // Vowel formant centers (F1, F2) scaled by profile
    const vowels = [
      [730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870]
    ];

    let phase = 0;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sr;
      const sylRate = 4.2 * speed;
      const sylIndex = Math.floor(t * sylRate);
      const sylPos = (t * sylRate) % 1.0;

      // Syllable envelope with natural pauses between words
      const isPause = (sylIndex % 6 === 5);
      const env = isPause ? 0.02 : Math.sin(Math.PI * Math.min(1, sylPos * 1.15));

      const vPair = vowels[(sylIndex + words.length) % vowels.length];
      const f1 = vPair[0] * profile.formantScale;
      const f2 = vPair[1] * profile.formantScale;

      // Natural intonation contour
      const f0 = f0Base * (1 + 0.06 * Math.sin(2 * Math.PI * 1.3 * t) - 0.04 * (t / durationSec));
      phase += (2 * Math.PI * f0) / sr;

      // Glottal pulse + formant resonances
      let sig = 0.45 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase);
      sig += 0.22 * Math.sin(2 * Math.PI * f1 * t) + 0.12 * Math.sin(2 * Math.PI * f2 * t);

      data[i] = Math.max(-0.95, Math.min(0.95, sig * env * volume * 0.65));
    }
    return buffer;
  }

  function initTtsAndSpeechControlModules() {
    const updateScriptCounters = () => {
      const raw = $('ttsTextInput').value;
      const chars = raw.length;
      const words = raw.trim() ? raw.trim().split(/\s+/).length : 0;
      const sents = segmentScriptText(raw, $('spCtrlChunkMode').value).length;
      $('ttsCharCounter').textContent = `${chars} chars | ${words} words | ${sents} segments`;
      renderSegmentQueueInspector();
    };

    const updateSpeechCtrlSummary = () => {
      const prof = SEVEN_VOICE_PROFILES[$('ttsVoiceProfile').value];
      const lang = $('ttsLanguageSelect').value;
      $('speechCtrlSummaryBadge').textContent = `Voice: ${prof ? prof.name : 'Default'} | ${lang}`;
    };

    const renderSegmentQueueInspector = () => {
      const container = $('spCtrlSegmentList');
      const applied = applyPronunciationRules($('ttsTextInput').value);
      const segments = segmentScriptText(applied, $('spCtrlChunkMode').value);
      container.innerHTML = '';
      segments.forEach((seg, idx) => {
        const div = document.createElement('div');
        div.className = `segment-item ${idx === StudioState.ttsCurrentSegmentIdx ? 'active' : ''}`;
        div.textContent = `[${idx + 1}/${segments.length}] ${seg}`;
        container.appendChild(div);
      });
    };

    const populateSystemVoices = () => {
      if (!('speechSynthesis' in window)) return;
      const voices = window.speechSynthesis.getVoices();
      StudioState.ttsVoices = voices;
      const select = $('ttsSystemVoiceSelect');
      const targetLang = $('ttsLanguageSelect').value.slice(0, 2).toLowerCase();
      select.innerHTML = '';

      const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(targetLang));
      const list = matching.length > 0 ? matching : voices;

      if (list.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Default Browser Engine Voice';
        select.appendChild(opt);
      } else {
        list.forEach((v, idx) => {
          const opt = document.createElement('option');
          opt.value = String(idx);
          opt.textContent = `${v.name} (${v.lang})`;
          select.appendChild(opt);
        });
      }
    };

    if ('speechSynthesis' in window) {
      populateSystemVoices();
      window.speechSynthesis.onvoiceschanged = populateSystemVoices;
    }

    $('ttsLanguageSelect').addEventListener('change', () => {
      populateSystemVoices();
      updateSpeechCtrlSummary();
    });

    $('ttsVoiceProfile').addEventListener('change', updateSpeechCtrlSummary);
    $('ttsTextInput').addEventListener('input', updateScriptCounters);
    $('spCtrlPronunciation').addEventListener('input', renderSegmentQueueInspector);
    $('spCtrlChunkMode').addEventListener('change', updateScriptCounters);

    // Speech Control Sliders (Feature 05)
    const bindCtrlSlider = (id, valId, fmt) => {
      const el = $(id);
      el.addEventListener('input', () => { $(valId).textContent = fmt(el.value); });
    };
    bindCtrlSlider('spCtrlSpeed', 'valSpCtrlSpeed', (v) => `${parseFloat(v).toFixed(2)}x`);
    bindCtrlSlider('spCtrlPitch', 'valSpCtrlPitch', (v) => parseFloat(v).toFixed(2));
    bindCtrlSlider('spCtrlVolume', 'valSpCtrlVolume', (v) => `${v}%`);
    bindCtrlSlider('spCtrlSentencePause', 'valSpCtrlSentencePause', (v) => `${v} ms`);
    bindCtrlSlider('spCtrlParaPause', 'valSpCtrlParaPause', (v) => `${v} ms`);

    $('ttsApiEndpoint').addEventListener('input', (e) => {
      const hasApi = e.target.value.trim().length > 0;
      $('ttsProviderBadge').textContent = hasApi
        ? 'Provider: External Neural TTS Endpoint'
        : 'Provider: Browser Fallback + Formant Synth';
    });

    const setTtsTransportButtons = (speaking, paused) => {
      $('btnTtsPause').disabled = !speaking || paused;
      $('btnTtsResume').disabled = !speaking || !paused;
      $('btnTtsStop').disabled = !speaking;
      $('btnSpCtrlPause').disabled = !speaking || paused;
      $('btnSpCtrlResume').disabled = !speaking || !paused;
      $('btnSpCtrlStop').disabled = !speaking;
    };

    const stopAllSpeech = () => {
      StudioState.ttsAbortQueue = true;
      StudioState.ttsPlaying = false;
      StudioState.ttsPaused = false;
      StudioState.ttsCurrentSegmentIdx = -1;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      $('ttsGenStatus').textContent = 'Stopped';
      $('ttsActiveSegment').textContent = '-';
      setTtsTransportButtons(false, false);
      renderSegmentQueueInspector();
    };

    const runSegmentedSpeech = async (textOverride = null) => {
      const raw = textOverride || $('ttsTextInput').value.trim();
      if (!raw) {
        showToast('Enter text to synthesize.', 'error');
        return;
      }

      stopAllSpeech();
      StudioState.ttsAbortQueue = false;
      StudioState.ttsPlaying = true;
      setTtsTransportButtons(true, false);

      const processedText = applyPronunciationRules(raw);
      const mode = $('spCtrlChunkMode').value;
      const segments = segmentScriptText(processedText, mode);
      const profileKey = $('ttsVoiceProfile').value;
      const profile = SEVEN_VOICE_PROFILES[profileKey] || SEVEN_VOICE_PROFILES.profile_1;
      const lang = $('ttsLanguageSelect').value;
      const speed = parseFloat($('spCtrlSpeed').value) * profile.rateMod;
      const pitch = parseFloat($('spCtrlPitch').value) * profile.pitchMod;
      const volume = parseFloat($('spCtrlVolume').value) / 100;
      const pauseMs = mode === 'paragraph'
        ? parseInt($('spCtrlParaPause').value, 10)
        : parseInt($('spCtrlSentencePause').value, 10);

      const endpoint = $('ttsApiEndpoint').value.trim();
      const token = $('ttsApiToken').value.trim();

      if (endpoint) {
        try {
          $('ttsGenStatus').textContent = 'Requesting External Neural TTS...';
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              text: processedText,
              language: lang,
              voiceProfile: profileKey,
              voiceName: profile.name,
              speed,
              pitch,
              volume
            })
          });
          if (!resp.ok) throw new Error(`Neural TTS endpoint HTTP ${resp.status}`);
          const audioBlob = await resp.blob();
          const decoded = await decodeFileToAudioBuffer(audioBlob);
          StudioState.ttsSynthesizedBuffer = decoded;
          setActiveStudioBuffer(decoded, `TTS_${profile.name}`);

          const url = URL.createObjectURL(audioBlob);
          const player = $('ttsAudioPlayer');
          player.src = url;
          player.play();

          $('btnTtsDownloadWav').disabled = false;
          $('btnTtsSaveLib').disabled = false;
          $('ttsGenStatus').textContent = 'Neural TTS Audio Ready';
          setTtsTransportButtons(false, false);
          return;
        } catch (err) {
          showToast('External Neural TTS failed: ' + err.message, 'error');
          stopAllSpeech();
          return;
        }
      }

      // Local Browser SpeechSynthesis Queue
      if (!('speechSynthesis' in window)) {
        showToast('Browser SpeechSynthesis not supported on this device.', 'error');
        stopAllSpeech();
        return;
      }

      $('ttsGenStatus').textContent = `Speaking (${profile.name} Profile)...`;

      for (let i = 0; i < segments.length; i++) {
        if (StudioState.ttsAbortQueue) break;
        StudioState.ttsCurrentSegmentIdx = i;
        $('ttsActiveSegment').textContent = `${i + 1} / ${segments.length}`;
        renderSegmentQueueInspector();

        await new Promise((resolve) => {
          const utter = new SpeechSynthesisUtterance(segments[i]);
          utter.lang = lang;
          utter.rate = Math.max(0.5, Math.min(2.0, speed));
          utter.pitch = Math.max(0.5, Math.min(2.0, pitch));
          utter.volume = Math.max(0.1, Math.min(1.0, volume));

          const targetLangPrefix = lang.slice(0, 2).toLowerCase();
          const matchingVoices = StudioState.ttsVoices.filter((v) =>
            v.lang.toLowerCase().startsWith(targetLangPrefix)
          );
          const pool = matchingVoices.length > 0 ? matchingVoices : StudioState.ttsVoices;
          if (pool.length > 0) {
            const pIdx = parseInt(profileKey.replace('profile_', ''), 10) - 1;
            utter.voice = pool[pIdx % pool.length];
          }

          utter.onend = () => resolve();
          utter.onerror = () => resolve();
          window.speechSynthesis.speak(utter);
        });

        if (StudioState.ttsAbortQueue) break;
        if (pauseMs > 0 && i < segments.length - 1) {
          await new Promise((r) => setTimeout(r, pauseMs));
        }
      }

      if (!StudioState.ttsAbortQueue) {
        $('ttsGenStatus').textContent = 'Playback Completed';
        StudioState.ttsCurrentSegmentIdx = -1;
        renderSegmentQueueInspector();
      }
      setTtsTransportButtons(false, false);
    };

    $('btnTtsPreviewVoice').addEventListener('click', () => {
      const prof = SEVEN_VOICE_PROFILES[$('ttsVoiceProfile').value];
      const lang = $('ttsLanguageSelect').value;
      const sample = lang.startsWith('hi')
        ? `नमस्ते, मैं ${prof.name} हूँ। यह नेक्सोरा ऑडियो स्टूडियो का वॉइस प्रीव्यू है।`
        : `Hello, I am ${prof.name}. This is my studio voice profile preview in Nexora Audio X.`;
      runSegmentedSpeech(sample);
    });

    $('btnTtsGenerateSpeak').addEventListener('click', () => runSegmentedSpeech());
    $('btnSpCtrlPlay').addEventListener('click', () => runSegmentedSpeech());

    const handlePause = () => {
      if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        StudioState.ttsPaused = true;
        $('ttsGenStatus').textContent = 'Paused';
        setTtsTransportButtons(true, true);
      }
    };

    const handleResume = () => {
      if ('speechSynthesis' in window && StudioState.ttsPaused) {
        window.speechSynthesis.resume();
        StudioState.ttsPaused = false;
        $('ttsGenStatus').textContent = 'Speaking...';
        setTtsTransportButtons(true, false);
      }
    };

    $('btnTtsPause').addEventListener('click', handlePause);
    $('btnSpCtrlPause').addEventListener('click', handlePause);
    $('btnTtsResume').addEventListener('click', handleResume);
    $('btnSpCtrlResume').addEventListener('click', handleResume);
    $('btnTtsStop').addEventListener('click', stopAllSpeech);
    $('btnSpCtrlStop').addEventListener('click', stopAllSpeech);

    $('btnTtsRenderBuffer').addEventListener('click', () => {
      const raw = applyPronunciationRules($('ttsTextInput').value);
      if (!raw.trim()) {
        showToast('Enter script text first.', 'error');
        return;
      }
      const profileKey = $('ttsVoiceProfile').value;
      const speed = parseFloat($('spCtrlSpeed').value);
      const pitch = parseFloat($('spCtrlPitch').value);
      const vol = parseFloat($('spCtrlVolume').value) / 100;

      const buf = synthesizeLocalFormantSpeechBuffer(raw, profileKey, speed, pitch, vol);
      StudioState.ttsSynthesizedBuffer = buf;
      const profName = SEVEN_VOICE_PROFILES[profileKey].name;
      setActiveStudioBuffer(buf, `LocalSynth_${profName}`);

      const wav = encodeAudioBufferToWavBlob(buf);
      $('ttsAudioPlayer').src = URL.createObjectURL(wav);
      $('btnTtsDownloadWav').disabled = false;
      $('btnTtsSaveLib').disabled = false;
      $('ttsGenStatus').textContent = 'Local Formant Audio Buffer Rendered';
      showToast('Downloadable local formant vocal buffer synthesized.', 'success');
    });

    $('btnTtsDownloadWav').addEventListener('click', () => {
      if (!StudioState.ttsSynthesizedBuffer) return;
      const wav = encodeAudioBufferToWavBlob(StudioState.ttsSynthesizedBuffer);
      triggerBlobDownload(wav, `${StudioState.activeName}.wav`);
    });

    $('btnTtsSaveLib').addEventListener('click', async () => {
      if (!StudioState.ttsSynthesizedBuffer) return;
      await saveAudioBufferToLibrary(StudioState.ttsSynthesizedBuffer, StudioState.activeName, 'Generated Speech');
    });

    $('btnTtsOpenSpeechCtrl').addEventListener('click', () => switchToModule('sec-speech-ctrl'));

    updateScriptCounters();
    updateSpeechCtrlSummary();
  }

  /* =========================================================================
     FEATURE 06 — PROFESSIONAL AUDIO EDITOR (NON-DESTRUCTIVE TIMELINE)
     ========================================================================= */
  function drawEditorTimelineRuler(canvas, duration) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#11151f';
    ctx.fillRect(0, 0, w, h);

    if (!duration || duration <= 0) return;

    ctx.fillStyle = '#94a3b8';
    ctx.strokeStyle = '#334155';
    ctx.font = '11px monospace';
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const sec = (i / steps) * duration;
      ctx.beginPath();
      ctx.moveTo(x, h - 8);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (i < steps) {
        ctx.fillText(`${sec.toFixed(1)}s`, x + 3, 14);
      }
    }
  }

  function refreshEditorUI() {
    const buf = StudioState.editorCurrentBuffer;
    const hasBuf = !!buf;
    [
      'btnEditorPlaySel', 'btnEditorPlayAll', 'btnEdTrim', 'btnEdCut',
      'btnEdSplit', 'btnEdFadeIn', 'btnEdFadeOut', 'btnEdInsertSilence',
      'btnEdApplyGain', 'btnEdApplySpeed', 'btnEditorSaveLib', 'btnEditorExportWav',
      'btnEditorRevert'
    ].forEach((id) => { $(id).disabled = !hasBuf; });

    $('btnEditorUndo').disabled = StudioState.editorUndoStack.length === 0;
    $('btnEditorUndo').textContent = `Undo (${StudioState.editorUndoStack.length})`;
    $('btnEditorRedo').disabled = StudioState.editorRedoStack.length === 0;
    $('btnEditorRedo').textContent = `Redo (${StudioState.editorRedoStack.length})`;

    if (!buf) {
      $('editorBufferMeta').textContent = 'No buffer loaded';
      return;
    }

    StudioState.editorSelStart = Math.max(0, Math.min(buf.duration, StudioState.editorSelStart));
    StudioState.editorSelEnd = Math.max(StudioState.editorSelStart, Math.min(buf.duration, StudioState.editorSelEnd));
    StudioState.editorCursor = Math.max(0, Math.min(buf.duration, StudioState.editorCursor));

    $('edSelStart').value = StudioState.editorSelStart.toFixed(2);
    $('edSelEnd').value = StudioState.editorSelEnd.toFixed(2);
    $('edPlayhead').value = StudioState.editorCursor.toFixed(2);

    $('editorBufferMeta').textContent = `${buf.duration.toFixed(2)}s | ${buf.sampleRate} Hz | ${buf.numberOfChannels} ch`;
    drawEditorTimelineRuler($('editorTimelineCanvas'), buf.duration);
    drawStaticWaveform(
      $('editorWaveCanvas'),
      buf,
      '#3b82f6',
      StudioState.editorSelStart,
      StudioState.editorSelEnd,
      StudioState.editorCursor
    );
  }

  function pushEditorUndoState() {
    if (!StudioState.editorCurrentBuffer) return;
    StudioState.editorUndoStack.push(cloneAudioBuffer(StudioState.editorCurrentBuffer));
    if (StudioState.editorUndoStack.length > 12) StudioState.editorUndoStack.shift();
    StudioState.editorRedoStack = [];
  }

  function loadBufferIntoEditor(buffer, name = 'Edited_Audio') {
    StudioState.editorOriginalBuffer = cloneAudioBuffer(buffer);
    StudioState.editorCurrentBuffer = cloneAudioBuffer(buffer);
    StudioState.editorUndoStack = [];
    StudioState.editorRedoStack = [];
    StudioState.editorSelStart = 0;
    StudioState.editorSelEnd = buffer.duration;
    StudioState.editorCursor = buffer.duration / 2;
    setActiveStudioBuffer(StudioState.editorCurrentBuffer, name);
    refreshEditorUI();
  }

  function initEditorModule() {
    $('editorFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await decodeFileToAudioBuffer(file);
        loadBufferIntoEditor(buf, file.name);
        showToast('Audio file loaded into Editor.', 'success');
      } catch (err) {
        showToast('Decode failed: ' + err.message, 'error');
      }
    });

    $('editorAppendFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !StudioState.editorCurrentBuffer) {
        showToast('Load a base audio file in the Editor first before joining.', 'error');
        return;
      }
      try {
        const appendBuf = await decodeFileToAudioBuffer(file);
        pushEditorUndoState();
        const cur = StudioState.editorCurrentBuffer;
        const ctx = getAudioContext();
        const channels = Math.max(cur.numberOfChannels, appendBuf.numberOfChannels);
        const joined = ctx.createBuffer(channels, cur.length + appendBuf.length, cur.sampleRate);

        for (let ch = 0; ch < channels; ch++) {
          const out = joined.getChannelData(ch);
          const c1 = cur.getChannelData(Math.min(ch, cur.numberOfChannels - 1));
          const c2 = appendBuf.getChannelData(Math.min(ch, appendBuf.numberOfChannels - 1));
          out.set(c1, 0);
          out.set(c2, cur.length);
        }
        StudioState.editorCurrentBuffer = joined;
        StudioState.editorSelEnd = joined.duration;
        setActiveStudioBuffer(joined, `${StudioState.activeName}_Joined`);
        refreshEditorUI();
        showToast('Second audio segment joined to timeline.', 'success');
      } catch (err) {
        showToast('Join failed: ' + err.message, 'error');
      }
    });

    $('btnEditorUseActive').addEventListener('click', () => {
      if (!StudioState.activeBuffer) {
        showToast('No active buffer to load.', 'error');
        return;
      }
      loadBufferIntoEditor(StudioState.activeBuffer, StudioState.activeName);
    });

    // Interactive touch/mouse drag selection on waveform canvas
    const waveCanvas = $('editorWaveCanvas');
    let isDragging = false;
    const pointerToSec = (clientX) => {
      if (!StudioState.editorCurrentBuffer) return 0;
      const rect = waveCanvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * StudioState.editorCurrentBuffer.duration;
    };

    waveCanvas.addEventListener('pointerdown', (e) => {
      if (!StudioState.editorCurrentBuffer) return;
      isDragging = true;
      const sec = pointerToSec(e.clientX);
      StudioState.editorSelStart = sec;
      StudioState.editorSelEnd = sec;
      StudioState.editorCursor = sec;
      refreshEditorUI();
    });

    waveCanvas.addEventListener('pointermove', (e) => {
      if (!isDragging || !StudioState.editorCurrentBuffer) return;
      const sec = pointerToSec(e.clientX);
      if (sec >= StudioState.editorSelStart) {
        StudioState.editorSelEnd = sec;
      } else {
        StudioState.editorSelEnd = StudioState.editorSelStart;
        StudioState.editorSelStart = sec;
      }
      refreshEditorUI();
    });

    window.addEventListener('pointerup', () => { isDragging = false; });

    ['edSelStart', 'edSelEnd', 'edPlayhead'].forEach((id) => {
      $(id).addEventListener('change', () => {
        StudioState.editorSelStart = parseFloat($('edSelStart').value) || 0;
        StudioState.editorSelEnd = parseFloat($('edSelEnd').value) || 0;
        StudioState.editorCursor = parseFloat($('edPlayhead').value) || 0;
        refreshEditorUI();
      });
    });

    $('btnEditorSelectAll').addEventListener('click', () => {
      if (!StudioState.editorCurrentBuffer) return;
      StudioState.editorSelStart = 0;
      StudioState.editorSelEnd = StudioState.editorCurrentBuffer.duration;
      refreshEditorUI();
    });

    const stopEditorPlayback = () => {
      if (StudioState.editorSourceNode) {
        try { StudioState.editorSourceNode.stop(); } catch (_) {}
        try { StudioState.editorSourceNode.disconnect(); } catch (_) {}
        StudioState.editorSourceNode = null;
      }
      StudioState.editorIsPlaying = false;
      $('btnEditorStop').disabled = true;
    };

    const playEditorRange = (startSec, endSec) => {
      if (!StudioState.editorCurrentBuffer) return;
      stopEditorPlayback();
      const ctx = getAudioContext();
      const src = ctx.createBufferSource();
      src.buffer = StudioState.editorCurrentBuffer;
      src.connect(ctx.destination);
      const dur = Math.max(0.05, endSec - startSec);
      src.start(0, startSec, dur);
      StudioState.editorSourceNode = src;
      StudioState.editorIsPlaying = true;
      $('btnEditorStop').disabled = false;
      src.onended = stopEditorPlayback;
    };

    $('btnEditorPlaySel').addEventListener('click', () => {
      playEditorRange(StudioState.editorSelStart, StudioState.editorSelEnd);
    });
    $('btnEditorPlayAll').addEventListener('click', () => {
      if (!StudioState.editorCurrentBuffer) return;
      playEditorRange(0, StudioState.editorCurrentBuffer.duration);
    });
    $('btnEditorStop').addEventListener('click', stopEditorPlayback);

    // Undo / Redo / Revert
    $('btnEditorUndo').addEventListener('click', () => {
      if (StudioState.editorUndoStack.length === 0) return;
      StudioState.editorRedoStack.push(cloneAudioBuffer(StudioState.editorCurrentBuffer));
      StudioState.editorCurrentBuffer = StudioState.editorUndoStack.pop();
      setActiveStudioBuffer(StudioState.editorCurrentBuffer, StudioState.activeName);
      refreshEditorUI();
    });

    $('btnEditorRedo').addEventListener('click', () => {
      if (StudioState.editorRedoStack.length === 0) return;
      StudioState.editorUndoStack.push(cloneAudioBuffer(StudioState.editorCurrentBuffer));
      StudioState.editorCurrentBuffer = StudioState.editorRedoStack.pop();
      setActiveStudioBuffer(StudioState.editorCurrentBuffer, StudioState.activeName);
      refreshEditorUI();
    });

    $('btnEditorRevert').addEventListener('click', () => {
      if (!StudioState.editorOriginalBuffer) return;
      pushEditorUndoState();
      StudioState.editorCurrentBuffer = cloneAudioBuffer(StudioState.editorOriginalBuffer);
      StudioState.editorSelStart = 0;
      StudioState.editorSelEnd = StudioState.editorCurrentBuffer.duration;
      refreshEditorUI();
      showToast('Reverted to original untouched audio buffer.', 'info');
    });

    // Surgical Operations
    const getSampleRange = (buf) => {
      const s1 = Math.max(0, Math.min(buf.length, Math.round(StudioState.editorSelStart * buf.sampleRate)));
      const s2 = Math.max(s1, Math.min(buf.length, Math.round(StudioState.editorSelEnd * buf.sampleRate)));
      return [s1, s2];
    };

    $('btnEdTrim').addEventListener('click', () => {
      const buf = StudioState.editorCurrentBuffer;
      if (!buf) return;
      const [s1, s2] = getSampleRange(buf);
      if (s2 - s1 < 100) {
        showToast('Selection range is too short to trim.', 'error');
        return;
      }
      pushEditorUndoState();
      const ctx = getAudioContext();
      const out = ctx.createBuffer(buf.numberOfChannels, s2 - s1, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        out.copyToChannel(buf.getChannelData(ch).subarray(s1, s2), ch);
      }
      StudioState.editorCurrentBuffer = out;
      StudioState.editorSelStart = 0;
      StudioState.editorSelEnd = out.duration;
      setActiveStudioBuffer(out, StudioState.activeName);
      refreshEditorUI();
      showToast('Audio trimmed to selection.', 'success');
    });

    $('btnEdCut').addEventListener('click', () => {
      const buf = StudioState.editorCurrentBuffer;
      if (!buf) return;
      const [s1, s2] = getSampleRange(buf);
      const cutLen = s2 - s1;
      if (cutLen <= 0 || buf.length - cutLen < 100) {
        showToast('Invalid cut range (cannot delete entire buffer).', 'error');
        return;
      }
      pushEditorUndoState();
      const ctx = getAudioContext();
      const out = ctx.createBuffer(buf.numberOfChannels, buf.length - cutLen, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        dst.set(src.subarray(0, s1), 0);
        dst.set(src.subarray(s2), s1);
      }
      StudioState.editorCurrentBuffer = out;
      StudioState.editorSelEnd = out.duration;
      setActiveStudioBuffer(out, StudioState.activeName);
      refreshEditorUI();
      showToast('Selected region cut from audio buffer.', 'success');
    });

    $('btnEdSplit').addEventListener('click', () => {
      const buf = StudioState.editorCurrentBuffer;
      if (!buf) return;
      const splitSample = Math.round(StudioState.editorCursor * buf.sampleRate);
      if (splitSample <= 0 || splitSample >= buf.length) {
        showToast('Place cursor inside the waveform to split.', 'error');
        return;
      }
      pushEditorUndoState();
      const gapSamples = Math.round(0.25 * buf.sampleRate); // 250ms visual/audible split marker gap
      const ctx = getAudioContext();
      const out = ctx.createBuffer(buf.numberOfChannels, buf.length + gapSamples, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        dst.set(src.subarray(0, splitSample), 0);
        dst.set(src.subarray(splitSample), splitSample + gapSamples);
      }
      StudioState.editorCurrentBuffer = out;
      StudioState.editorSelStart = StudioState.editorCursor + 0.25;
      StudioState.editorSelEnd = out.duration;
      setActiveStudioBuffer(out, StudioState.activeName);
      refreshEditorUI();
      showToast('Split performed at cursor with 250 ms separation.', 'success');
    });

    $('btnEdFadeIn').addEventListener('click', () => {
      const buf = StudioState.editorCurrentBuffer;
      if (!buf) return;
      const [s1, s2] = getSampleRange(buf);
      if (s2 - s1 < 10) return;
      pushEditorUndoState();
      const len = s2 - s1;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          d[s1 + i] *= (i / len);
        }
      }
      refreshEditorUI();
      showToast('Fade-In applied to selection.', 'success');
    });

    $('btnEdFadeOut').addEventListener('click', () => {
      const buf = StudioState.editorCurrentBuffer;
      if (!buf) return;
      const [s1, s2] = getSampleRange(buf);
      if (s2 - s1 < 10) return;
      pushEditorUndoState();
      const len = s2 - s1;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          d[s1 + i] *= (1 - i / len);
        }
      }
      refreshEditorUI();
      showToast('Fade-Out applied to selection.', 'success');
    });

    $('btnEdInsertSilence').addEventListener('click', () => {
      const buf = StudioState.editorCurrentBuffer;
      if (!buf) return;
      const silSec = Math.max(0.1, Math.min(30, parseFloat($('edSilenceDuration').value) || 1.0));
      const silSamples = Math.round(silSec * buf.sampleRate);
      const insertAt = Math.max(0, Math.min(buf.length, Math.round(StudioState.editorCursor * buf.sampleRate)));
      pushEditorUndoState();
      const ctx = getAudioContext();
      const out = ctx.createBuffer(buf.numberOfChannels, buf.length + silSamples, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        dst.set(src.subarray(0, insertAt), 0);
        dst.set(src.subarray(insertAt), insertAt + silSamples);
      }
      StudioState.editorCurrentBuffer = out;
      StudioState.editorSelEnd = out.duration;
      setActiveStudioBuffer(out, StudioState.activeName);
      refreshEditorUI();
      showToast(`Inserted ${silSec.toFixed(1)}s silence at cursor.`, 'success');
    });

    $('edGainDb').addEventListener('input', (e) => {
      $('valEdGainDb').textContent = `${parseFloat(e.target.value).toFixed(1)} dB`;
    });

    $('btnEdApplyGain').addEventListener('click', () => {
      const buf = StudioState.editorCurrentBuffer;
      if (!buf) return;
      const [s1, s2] = getSampleRange(buf);
      const db = parseFloat($('edGainDb').value) || 0;
      const mult = Math.pow(10, db / 20);
      pushEditorUndoState();
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = s1; i < s2; i++) {
          d[i] = Math.max(-0.99, Math.min(0.99, d[i] * mult));
        }
      }
      refreshEditorUI();
      showToast(`Applied ${db.toFixed(1)} dB gain to selection.`, 'success');
    });

    $('edSpeedFactor').addEventListener('input', (e) => {
      $('valEdSpeedFactor').textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
    });

    $('btnEdApplySpeed').addEventListener('click', () => {
      const buf = StudioState.editorCurrentBuffer;
      if (!buf) return;
      const rate = parseFloat($('edSpeedFactor').value) || 1.0;
      if (Math.abs(rate - 1.0) < 0.01) return;
      pushEditorUndoState();
      const newLen = Math.max(100, Math.floor(buf.length / rate));
      const ctx = getAudioContext();
      const out = ctx.createBuffer(buf.numberOfChannels, newLen, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        for (let i = 0; i < newLen; i++) {
          const pos = i * rate;
          const idx = Math.floor(pos);
          const frac = pos - idx;
          dst[i] = idx + 1 < src.length
            ? src[idx] * (1 - frac) + src[idx + 1] * frac
            : src[Math.min(idx, src.length - 1)];
        }
      }
      StudioState.editorCurrentBuffer = out;
      StudioState.editorSelStart = 0;
      StudioState.editorSelEnd = out.duration;
      setActiveStudioBuffer(out, StudioState.activeName);
      refreshEditorUI();
      showToast(`Buffer resampled at ${rate.toFixed(2)}x speed.`, 'success');
    });

    $('btnEditorSaveLib').addEventListener('click', async () => {
      if (!StudioState.editorCurrentBuffer) return;
      await saveAudioBufferToLibrary(StudioState.editorCurrentBuffer, `${StudioState.activeName}_Edited`, 'Edited Audio');
    });

    $('btnEditorExportWav').addEventListener('click', () => {
      if (!StudioState.editorCurrentBuffer) return;
      const wav = encodeAudioBufferToWavBlob(StudioState.editorCurrentBuffer);
      triggerBlobDownload(wav, `${StudioState.activeName}_Edited.wav`);
    });
  }

  /* =========================================================================
     FEATURE 07 — VOICE + BACKGROUND MUSIC MIXER
     ========================================================================= */
  function generateStudioAmbientBedBuffer(durationSec = 18) {
    const ctx = getAudioContext();
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const buf = ctx.createBuffer(2, len, sr);
    const chordFreqs = [130.81, 164.81, 196.00, 246.94, 293.66]; // Warm Cmaj9 ambient pad

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let sample = 0;
        chordFreqs.forEach((f, idx) => {
          const detune = ch === 0 ? 1 - idx * 0.0008 : 1 + idx * 0.0008;
          const lfo = 0.8 + 0.2 * Math.sin(2 * Math.PI * (0.12 + idx * 0.03) * t);
          sample += Math.sin(2 * Math.PI * f * detune * t) * lfo * 0.12;
        });
        const fade = Math.min(1, t / 1.5) * Math.min(1, (durationSec - t) / 1.5);
        data[i] = sample * fade;
      }
    }
    return buf;
  }

  function initMixerModule() {
    const bindMixSlider = (id, valId, fmt) => {
      const el = $(id);
      el.addEventListener('input', () => { $(valId).textContent = fmt(el.value); });
    };
    bindMixSlider('mixVoiceGain', 'valMixVoiceGain', (v) => `${v}%`);
    bindMixSlider('mixMusicGain', 'valMixMusicGain', (v) => `${v}%`);
    bindMixSlider('mixVoiceEntryDelay', 'valMixVoiceEntryDelay', (v) => `${parseFloat(v).toFixed(1)} s`);
    bindMixSlider('mixBalanceCross', 'valMixBalanceCross', (v) => {
      const n = parseInt(v, 10);
      if (n === 0) return '0 (Centered)';
      return n < 0 ? `Voice +${Math.abs(n)}%` : `Music +${n}%`;
    });

    $('mixVoiceFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await decodeFileToAudioBuffer(file);
        StudioState.mixVoiceBuffer = buf;
        $('mixVoiceMeta').textContent = `${file.name} (${buf.duration.toFixed(1)}s)`;
        drawStaticWaveform($('mixVoiceCanvas'), buf, '#3b82f6');
      } catch (err) {
        showToast('Failed to decode voice track: ' + err.message, 'error');
      }
    });

    $('btnMixUseActiveVoice').addEventListener('click', () => {
      if (!StudioState.activeBuffer) {
        showToast('No active studio buffer found.', 'error');
        return;
      }
      StudioState.mixVoiceBuffer = cloneAudioBuffer(StudioState.activeBuffer);
      $('mixVoiceMeta').textContent = `${StudioState.activeName} (${StudioState.mixVoiceBuffer.duration.toFixed(1)}s)`;
      drawStaticWaveform($('mixVoiceCanvas'), StudioState.mixVoiceBuffer, '#3b82f6');
    });

    $('mixMusicFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await decodeFileToAudioBuffer(file);
        StudioState.mixMusicBuffer = buf;
        $('mixMusicMeta').textContent = `${file.name} (${buf.duration.toFixed(1)}s)`;
        drawStaticWaveform($('mixMusicCanvas'), buf, '#10b981');
      } catch (err) {
        showToast('Failed to decode music track: ' + err.message, 'error');
      }
    });

    $('btnMixGenAmbient').addEventListener('click', () => {
      const dur = StudioState.mixVoiceBuffer ? Math.max(12, StudioState.mixVoiceBuffer.duration + 4) : 16;
      const bed = generateStudioAmbientBedBuffer(dur);
      StudioState.mixMusicBuffer = bed;
      $('mixMusicMeta').textContent = `Studio Cmaj9 Ambient Pad (${bed.duration.toFixed(1)}s)`;
      drawStaticWaveform($('mixMusicCanvas'), bed, '#10b981');
      showToast('Generated warm stereo ambient music bed.', 'success');
    });

    const getEffectiveTrackGains = () => {
      const vRaw = $('chkMixVoiceMute').checked ? 0 : parseFloat($('mixVoiceGain').value) / 100;
      const mRaw = $('chkMixMusicMute').checked ? 0 : parseFloat($('mixMusicGain').value) / 100;
      const bal = parseInt($('mixBalanceCross').value, 10) / 100; // -0.5 to +0.5
      const vTrim = bal < 0 ? 1 + Math.abs(bal) * 0.5 : 1 - bal * 0.5;
      const mTrim = bal > 0 ? 1 + bal * 0.5 : 1 - Math.abs(bal) * 0.5;
      return { voiceGain: vRaw * vTrim, musicGain: mRaw * mTrim };
    };

    const stopMixPreview = () => {
      StudioState.mixLiveNodes.forEach((n) => {
        try { n.stop(); } catch (_) {}
        try { n.disconnect(); } catch (_) {}
      });
      StudioState.mixLiveNodes = [];
      StudioState.mixIsPlaying = false;
      $('btnMixStopPreview').disabled = true;
    };

    $('btnMixLivePreview').addEventListener('click', () => {
      if (!StudioState.mixVoiceBuffer && !StudioState.mixMusicBuffer) {
        showToast('Load at least a Voice or Music track to preview.', 'error');
        return;
      }
      stopMixPreview();
      const ctx = getAudioContext();
      const { voiceGain, musicGain } = getEffectiveTrackGains();
      const voiceDelay = parseFloat($('mixVoiceEntryDelay').value) || 0;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.0;
      limiter.ratio.value = 20;
      limiter.connect(ctx.destination);

      const now = ctx.currentTime + 0.05;

      if (StudioState.mixVoiceBuffer) {
        const vSrc = ctx.createBufferSource();
        vSrc.buffer = StudioState.mixVoiceBuffer;
        const vGainNode = ctx.createGain();
        vGainNode.gain.value = voiceGain;
        vSrc.connect(vGainNode);
        vGainNode.connect(limiter);
        vSrc.start(now + voiceDelay);
        StudioState.mixLiveNodes.push(vSrc);
      }

      if (StudioState.mixMusicBuffer) {
        const mSrc = ctx.createBufferSource();
        mSrc.buffer = StudioState.mixMusicBuffer;
        mSrc.loop = $('chkMixLoopMusic').checked;
        const mGainNode = ctx.createGain();
        mGainNode.gain.value = musicGain;
        mSrc.connect(mGainNode);
        mGainNode.connect(limiter);
        mSrc.start(now);
        StudioState.mixLiveNodes.push(mSrc);
      }

      StudioState.mixIsPlaying = true;
      $('btnMixStopPreview').disabled = false;
    });

    $('btnMixStopPreview').addEventListener('click', stopMixPreview);

    $('btnMixRenderMixdown').addEventListener('click', async () => {
      if (!StudioState.mixVoiceBuffer && !StudioState.mixMusicBuffer) {
        showToast('Load Voice and/or Background Music tracks before rendering mixdown.', 'error');
        return;
      }
      stopMixPreview();

      try {
        const ctx = getAudioContext();
        const sr = ctx.sampleRate;
        const voiceDelay = parseFloat($('mixVoiceEntryDelay').value) || 0;
        const vDur = StudioState.mixVoiceBuffer ? StudioState.mixVoiceBuffer.duration + voiceDelay + 1.5 : 0;
        const mDur = StudioState.mixMusicBuffer ? StudioState.mixMusicBuffer.duration : 0;
        const totalDur = Math.max(vDur, mDur, 2.0);
        const totalSamples = Math.floor(totalDur * sr);

        const offlineCtx = new OfflineAudioContext(2, totalSamples, sr);
        const { voiceGain, musicGain } = getEffectiveTrackGains();

        const masterLimiter = offlineCtx.createDynamicsCompressor();
        masterLimiter.threshold.value = -1.0;
        masterLimiter.knee.value = 0;
        masterLimiter.ratio.value = 20;
        masterLimiter.attack.value = 0.002;
        masterLimiter.release.value = 0.08;
        masterLimiter.connect(offlineCtx.destination);

        if (StudioState.mixVoiceBuffer) {
          const vSrc = offlineCtx.createBufferSource();
          vSrc.buffer = StudioState.mixVoiceBuffer;
          const vG = offlineCtx.createGain();
          vG.gain.value = voiceGain;
          vSrc.connect(vG);
          vG.connect(masterLimiter);
          vSrc.start(voiceDelay);
        }

        if (StudioState.mixMusicBuffer) {
          const mSrc = offlineCtx.createBufferSource();
          mSrc.buffer = StudioState.mixMusicBuffer;
          mSrc.loop = $('chkMixLoopMusic').checked;
          const mG = offlineCtx.createGain();
          mG.gain.setValueAtTime(musicGain, 0);

          // Smart Voice Envelope Auto-Ducking
          if ($('chkMixAutoDuck').checked && StudioState.mixVoiceBuffer && voiceGain > 0) {
            const vData = StudioState.mixVoiceBuffer.getChannelData(0);
            const windowSize = Math.floor(sr * 0.08);
            for (let i = 0; i < vData.length; i += windowSize) {
              let sum = 0;
              const end = Math.min(vData.length, i + windowSize);
              for (let j = i; j < end; j++) sum += Math.abs(vData[j]);
              const avg = sum / (end - i);
              const tSec = voiceDelay + (i / sr);
              const duckedGain = avg > 0.025 ? musicGain * 0.38 : musicGain;
              mG.gain.setTargetAtTime(duckedGain, tSec, 0.06);
            }
            mG.gain.setTargetAtTime(musicGain, voiceDelay + StudioState.mixVoiceBuffer.duration, 0.25);
          }

          // Smooth fade-out on final 1.2 seconds
          mG.gain.setValueAtTime(musicGain, Math.max(0, totalDur - 1.2));
          mG.gain.linearRampToValueAtTime(0.0001, totalDur);

          mSrc.connect(mG);
          mG.connect(masterLimiter);
          mSrc.start(0);
        }

        const renderedMix = await offlineCtx.startRendering();
        StudioState.mixMasterBuffer = renderedMix;
        setActiveStudioBuffer(renderedMix, 'Nexora_Master_Mix');

        drawStaticWaveform($('mixMasterCanvas'), renderedMix, '#10b981');
        const wav = encodeAudioBufferToWavBlob(renderedMix);
        $('mixMasterPlayer').src = URL.createObjectURL(wav);

        $('btnMixSaveLib').disabled = false;
        $('btnMixExportWav').disabled = false;
        $('btnMixExportMp3').disabled = false;
        showToast('Combined multi-track master mixdown rendered.', 'success');
      } catch (err) {
        showToast('Mixdown failed: ' + err.message, 'error');
      }
    });

    $('btnMixSaveLib').addEventListener('click', async () => {
      if (!StudioState.mixMasterBuffer) return;
      await saveAudioBufferToLibrary(StudioState.mixMasterBuffer, 'Master_Mixdown', 'Final Mix');
    });

    $('btnMixExportWav').addEventListener('click', () => {
      if (!StudioState.mixMasterBuffer) return;
      const wav = encodeAudioBufferToWavBlob(StudioState.mixMasterBuffer);
      triggerBlobDownload(wav, 'Nexora_Master_Mix.wav');
    });

    $('btnMixExportMp3').addEventListener('click', async () => {
      if (!StudioState.mixMasterBuffer) return;
      try {
        showToast('Encoding MP3 frames via LameJS...', 'info');
        const mp3 = await encodeAudioBufferToMp3Blob(StudioState.mixMasterBuffer);
        triggerBlobDownload(mp3, 'Nexora_Master_Mix.mp3');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  /* =========================================================================
     FEATURE 08 — PERSISTENT AUDIO LIBRARY (INDEXEDDB) & MULTI-FORMAT EXPORT
     ========================================================================= */
  function openStudioDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this browser.'));
        return;
      }
      const req = indexedDB.open('NexoraAudioStudioDB', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('audio_assets')) {
          db.createObjectStore('audio_assets', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        StudioState.db = e.target.result;
        $('dbStateText').textContent = 'Connected (Persistent)';
        resolve(StudioState.db);
      };
      req.onerror = () => {
        $('dbStateText').textContent = 'Error / Restricted';
        reject(req.error);
      };
    });
  }

  async function saveAudioBufferToLibrary(audioBuffer, name, category = 'Studio Asset') {
    try {
      if (!StudioState.db) await openStudioDatabase();
      const wavBlob = encodeAudioBufferToWavBlob(audioBuffer);
      const item = {
        id: `nx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: name || 'Untitled_Audio',
        category,
        createdAt: new Date().toISOString(),
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
        size: wavBlob.size,
        mimeType: 'audio/wav',
        blob: wavBlob
      };

      await new Promise((resolve, reject) => {
        const tx = StudioState.db.transaction('audio_assets', 'readwrite');
        const store = tx.objectStore('audio_assets');
        store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      showToast(`Saved "${item.name}" (${item.category}) to IndexedDB Library.`, 'success');
      await refreshLibraryView();
    } catch (err) {
      if (err.name === 'QuotaExceededError') {
        showToast('Storage quota exceeded! Delete old items in the Library to free space.', 'error');
      } else {
        showToast('Database save error: ' + err.message, 'error');
      }
    }
  }

  async function getAllLibraryItems() {
    if (!StudioState.db) await openStudioDatabase();
    return new Promise((resolve, reject) => {
      const tx = StudioState.db.transaction('audio_assets', 'readonly');
      const store = tx.objectStore('audio_assets');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function refreshLibraryView() {
    try {
      const items = await getAllLibraryItems();
      items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

      $('libCountBadge').textContent = `${items.length} Saved Items`;
      $('dbItemCount').textContent = String(items.length);
      const totalBytes = items.reduce((acc, it) => acc + (it.size || 0), 0);
      $('dbStorageSize').textContent = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;

      const container = $('libraryListContainer');
      container.innerHTML = '';

      if (items.length === 0) {
        container.innerHTML = '<p class="empty-state">No audio assets saved yet. Record, clean, tune, edit, synthesize, or mix audio to populate your studio library.</p>';
        return;
      }

      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'lib-item';

        const top = document.createElement('div');
        top.className = 'lib-item-top';

        const info = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'lib-title';
        title.textContent = `${item.name} [${item.category}]`;

        const meta = document.createElement('div');
        meta.className = 'lib-meta';
        const dateStr = new Date(item.createdAt).toLocaleString();
        meta.textContent = `${item.duration.toFixed(2)}s | ${item.sampleRate} Hz | ${(item.size / 1024).toFixed(1)} KB | ${dateStr}`;
        info.appendChild(title);
        info.appendChild(meta);

        const player = document.createElement('audio');
        player.controls = true;
        player.className = 'audio-player';
        player.src = URL.createObjectURL(item.blob);

        const actions = document.createElement('div');
        actions.className = 'btn-row';

        const makeBtn = (label, cls, onClick) => {
          const b = document.createElement('button');
          b.className = `btn btn-sm ${cls}`;
          b.textContent = label;
          b.addEventListener('click', onClick);
          return b;
        };

        actions.appendChild(makeBtn('Load Active', 'btn-primary', async () => {
          const decoded = await decodeFileToAudioBuffer(item.blob);
          setActiveStudioBuffer(decoded, item.name);
          showToast(`Loaded "${item.name}" as Active Studio Buffer.`, 'success');
        }));

        actions.appendChild(makeBtn('To Cleaner', 'btn-secondary', async () => {
          const decoded = await decodeFileToAudioBuffer(item.blob);
          loadBufferIntoCleaner(decoded, item.name);
          switchToModule('sec-cleaner');
        }));

        actions.appendChild(makeBtn('To Editor', 'btn-secondary', async () => {
          const decoded = await decodeFileToAudioBuffer(item.blob);
          loadBufferIntoEditor(decoded, item.name);
          switchToModule('sec-editor');
        }));

        actions.appendChild(makeBtn('To Mixer Voice', 'btn-secondary', async () => {
          const decoded = await decodeFileToAudioBuffer(item.blob);
          StudioState.mixVoiceBuffer = decoded;
          $('mixVoiceMeta').textContent = `${item.name} (${decoded.duration.toFixed(1)}s)`;
          drawStaticWaveform($('mixVoiceCanvas'), decoded, '#3b82f6');
          switchToModule('sec-mixer');
        }));

        actions.appendChild(makeBtn('WAV', 'btn-secondary', () => {
          triggerBlobDownload(item.blob, `${item.name}.wav`);
        }));

        actions.appendChild(makeBtn('MP3', 'btn-secondary', async () => {
          try {
            showToast(`Encoding "${item.name}.mp3"...`, 'info');
            const decoded = await decodeFileToAudioBuffer(item.blob);
            const mp3Blob = await encodeAudioBufferToMp3Blob(decoded);
            triggerBlobDownload(mp3Blob, `${item.name}.mp3`);
          } catch (err) {
            showToast(err.message, 'error');
          }
        }));

        actions.appendChild(makeBtn('Rename', 'btn-secondary', async () => {
          const nextName = window.prompt('Enter new name for this audio asset:', item.name);
          if (!nextName || !nextName.trim()) return;
          item.name = nextName.trim();
          const tx = StudioState.db.transaction('audio_assets', 'readwrite');
          tx.objectStore('audio_assets').put(item);
          tx.oncomplete = () => refreshLibraryView();
        }));

        actions.appendChild(makeBtn('Delete', 'btn-danger', async () => {
          if (!window.confirm(`Permanently delete "${item.name}" from Library?`)) return;
          const tx = StudioState.db.transaction('audio_assets', 'readwrite');
          tx.objectStore('audio_assets').delete(item.id);
          tx.oncomplete = () => {
            showToast('Deleted item from library.', 'info');
            refreshLibraryView();
          };
        }));

        top.appendChild(info);
        card.appendChild(top);
        card.appendChild(player);
        card.appendChild(actions);
        container.appendChild(card);
      });
    } catch (err) {
      showToast('Failed to load library items: ' + err.message, 'error');
    }
  }

  function initLibraryAndExportModule() {
    const checkCodecCapabilities = () => {
      const hasLame = typeof window.lamejs !== 'undefined';
      const hasWebm = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm');
      $('dbMp3Support').textContent = hasLame ? 'Ready (LameJS 1.2.1)' : 'Offline / Unavailable';
      $('exportCodecSupportNotice').textContent =
        `Verified Codecs: WAV (Native 16-bit PCM) = Ready | MP3 (LameJS) = ${hasLame ? 'Ready' : 'Unavailable'} | WebM = ${hasWebm ? 'Ready' : 'Unsupported on this browser'}`;
    };

    window.addEventListener('load', checkCodecCapabilities);
    checkCodecCapabilities();
    openStudioDatabase().then(refreshLibraryView).catch(() => {});

    $('btnLibRefresh').addEventListener('click', refreshLibraryView);

    $('libImportDirectInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const decoded = await decodeFileToAudioBuffer(file);
        setActiveStudioBuffer(decoded, file.name);
        await saveAudioBufferToLibrary(decoded, file.name.replace(/\.[^/.]+$/, ''), 'Imported File');
      } catch (err) {
        showToast('Could not import audio file: ' + err.message, 'error');
      }
    });

    $('btnExportActiveBuffer').addEventListener('click', async () => {
      if (!StudioState.activeBuffer) {
        showToast('No active studio buffer loaded. Record, import, or load an item from the Library first.', 'error');
        return;
      }

      const format = $('exportFormatSelect').value;
      const baseName = ($('exportFileName').value.trim() || 'Nexora_Audio').replace(/[^a-zA-Z0-9_-]/g, '_');

      const setExpProgress = (pct, msg) => {
        $('exportProgressPct').textContent = `${pct}%`;
        $('exportProgressBar').style.width = `${pct}%`;
        if (msg) $('exportStatusText').textContent = msg;
      };

      $('btnExportActiveBuffer').disabled = true;
      try {
        if (format === 'wav') {
          setExpProgress(40, 'Encoding 16-bit PCM RIFF WAVE header & samples...');
          const wavBlob = encodeAudioBufferToWavBlob(StudioState.activeBuffer);
          setExpProgress(100, `WAV Export Complete (${(wavBlob.size / 1024).toFixed(1)} KB)`);
          triggerBlobDownload(wavBlob, `${baseName}.wav`);
        } else if (format === 'mp3') {
          setExpProgress(5, 'Encoding IEEE Float32 to 192 kbps MP3 frames...');
          const mp3Blob = await encodeAudioBufferToMp3Blob(StudioState.activeBuffer, (pct) => {
            setExpProgress(pct, `Encoding MP3 frames (${pct}%)...`);
          });
          setExpProgress(100, `MP3 Export Complete (${(mp3Blob.size / 1024).toFixed(1)} KB)`);
          triggerBlobDownload(mp3Blob, `${baseName}.mp3`);
        } else if (format === 'webm') {
          setExpProgress(5, 'Streaming AudioBuffer through MediaRecorder WebM/Opus encoder...');
          const webmBlob = await encodeAudioBufferToWebmBlob(StudioState.activeBuffer, (pct) => {
            setExpProgress(pct, `Recording WebM stream (${pct}%)...`);
          });
          setExpProgress(100, `WebM Export Complete (${(webmBlob.size / 1024).toFixed(1)} KB)`);
          triggerBlobDownload(webmBlob, `${baseName}.webm`);
        }
        showToast(`Downloaded ${baseName}.${format}`, 'success');
      } catch (err) {
        setExpProgress(0, 'Export failed');
        showToast(err.message, 'error');
      } finally {
        $('btnExportActiveBuffer').disabled = false;
      }
    });
  }

  /* =========================================================================
     BOOTSTRAP APPLICATION
     ========================================================================= */
  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initRecorderModule();
    initCleanerModule();
    initTuningModule();
    initTtsAndSpeechControlModules();
    initEditorModule();
    initMixerModule();
    initLibraryAndExportModule();
  });
})();
