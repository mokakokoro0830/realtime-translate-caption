const $ = (id) => document.getElementById(id);

// 起動時に /health を確認して一時停止状態を反映
async function checkPausedState() {
  try {
    const res = await fetch("/health", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.paused) {
      document.body.classList.add("paused");
      const banner = document.getElementById("pauseBanner");
      const msg = document.getElementById("pauseBannerMessage");
      if (msg && data.pausedMessage) msg.textContent = data.pausedMessage;
      if (banner) banner.hidden = false;
      // Start ボタンは押せるが、押されたらメッセージを表示するように差し替え
      const startBtn = document.getElementById("startBtn");
      if (startBtn) {
        startBtn.title = data.pausedMessage || "現在停止中です";
        startBtn.setAttribute("aria-disabled", "true");
      }
    }
  } catch (_e) {
    // 失敗時は通常運用扱い
  }
}
checkPausedState();

const state = {
  pc: null,
  dc: null,
  micStream: null,
  remoteStream: null,
  connected: false,
  currentTranslation: "",
  currentTranscript: "",
  awaitingNextUtterance: false,
  historyAppendedForUtterance: false,
  commitTimer: null,  // 沈黙検出で履歴をコミットするためのタイマー
};

function setTranslationText(text, { placeholder = false } = {}) {
  const el = $("translation");
  el.textContent = text;
  el.classList.toggle("placeholder-text", placeholder);
  el.classList.toggle("live-text", !placeholder);
}

$("startBtn").addEventListener("click", startTranslation);
$("stopBtn").addEventListener("click", stopTranslation);
$("sourceLang").addEventListener("change", () => {
  if (state.dc?.readyState === "open") sendSessionUpdate(state.dc);
});
$("targetLang").addEventListener("change", () => {
  if (state.dc?.readyState === "open") sendSessionUpdate(state.dc);
});
$("swapLang").addEventListener("click", swapLanguages);
$("voiceOutput").addEventListener("change", () => {
  if (state.dc?.readyState === "open") sendSessionUpdate(state.dc);
  $("remoteAudio").muted = !$("voiceOutput").checked;
});
$("clearBtn").addEventListener("click", () => {
  $("history").innerHTML = "";
});

function swapLanguages() {
  const source = $("sourceLang");
  const target = $("targetLang");
  // auto は出力には使えないので、swap時は auto を Japanese に置き換える
  const sourceVal = source.value === "auto" ? "Japanese" : source.value;
  const targetVal = target.value;
  // target の選択肢に sourceVal があるか確認
  if (Array.from(target.options).some((o) => o.value === sourceVal)) {
    target.value = sourceVal;
  }
  if (Array.from(source.options).some((o) => o.value === targetVal)) {
    source.value = targetVal;
  }
  if (state.dc?.readyState === "open") sendSessionUpdate(state.dc);
}

async function startTranslation() {
  if (state.connected) return;
  if (document.body.classList.contains("paused")) {
    setBadge("停止中", "idle");
    setStatus(document.getElementById("pauseBannerMessage")?.textContent
      || "現在この翻訳機は一時停止中です。");
    return;
  }
  setBusy(true, "マイクを準備しています。");
  setBadge("接続中", "idle");

  try {
    state.currentTranslation = "";
    state.currentTranscript = "";
    state.awaitingNextUtterance = true;
    setTranslationText("マイクに向かって話してください", { placeholder: true });
    $("transcript").textContent = "— 元の音声 —";

    const pc = new RTCPeerConnection();
    const dc = pc.createDataChannel("oai-events");
    const remoteAudio = $("remoteAudio");
    remoteAudio.muted = !$("voiceOutput").checked;
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;

    pc.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        state.connected = true;
        setBadge("翻訳中", "live");
        setStatus("接続しました。相手の声をスマホに聞かせてください。");
      }
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        if (state.connected) stopTranslation();
      }
    };

    dc.onopen = () => {
      sendSessionUpdate(dc);
      setStatus("音声を待っています。短く区切って話すと翻訳が安定します。");
    };
    dc.onmessage = (event) => handleRealtimeEvent(JSON.parse(event.data));

    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const answerSdp = await fetchSdpAnswer(offer.sdp);
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    state.pc = pc;
    state.dc = dc;
    state.micStream = micStream;
    setControls(true);
  } catch (error) {
    console.error(error);
    setBadge("エラー", "error");
    setStatus(error.message || "接続に失敗しました。");
    stopTranslation();
  } finally {
    setBusy(false);
  }
}

async function fetchSdpAnswer(sdp) {
  const targetLang = LANG_INFO[$("targetLang").value]?.iso || "ja";
  const response = await fetch(`/session?lang=${encodeURIComponent(targetLang)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
    },
    body: sdp,
  });

  const body = await response.text();
  if (!response.ok) {
    let message = body;
    try {
      const json = JSON.parse(body);
      message = json.error || json.detail || body;
    } catch (_error) {
      // HTMLやプレーンテキストのエラーはそのまま使う。
    }
    throw new Error(message);
  }
  return body;
}

const LANG_INFO = {
  Japanese: {
    native: "日本語",
    iso: "ja",
    examples: [
      ["Hello, how are you?", "こんにちは、元気ですか？"],
      ["I'm going to the station.", "駅に行きます。"],
    ],
  },
  English: {
    native: "English",
    iso: "en",
    examples: [
      ["こんにちは、元気ですか？", "Hello, how are you?"],
      ["駅に行きます。", "I'm going to the station."],
    ],
  },
  Korean: {
    native: "한국어",
    iso: "ko",
    examples: [
      ["Hello, how are you?", "안녕하세요, 잘 지내세요?"],
      ["こんにちは。", "안녕하세요."],
    ],
  },
  Chinese: {
    native: "中文",
    iso: "zh",
    examples: [
      ["Hello, how are you?", "你好，最近怎么样？"],
      ["こんにちは。", "你好。"],
    ],
  },
  Spanish: {
    native: "Español",
    iso: "es",
    examples: [
      ["Hello, how are you?", "Hola, ¿cómo estás?"],
      ["こんにちは。", "Hola."],
    ],
  },
  French: {
    native: "Français",
    iso: "fr",
    examples: [
      ["Hello, how are you?", "Bonjour, comment ça va ?"],
      ["こんにちは。", "Bonjour."],
    ],
  },
  Thai: {
    native: "ภาษาไทย",
    iso: "th",
    examples: [
      ["Hello, how are you?", "สวัสดีครับ คุณสบายดีไหม?"],
      ["こんにちは。", "สวัสดีครับ"],
    ],
  },
  Hindi: {
    native: "हिन्दी",
    iso: "hi",
    examples: [
      ["Hello, how are you?", "नमस्ते, आप कैसे हैं?"],
      ["こんにちは。", "नमस्ते।"],
    ],
  },
  Portuguese: {
    native: "Português",
    iso: "pt",
    examples: [
      ["Hello, how are you?", "Olá, como você está?"],
      ["こんにちは。", "Olá."],
    ],
  },
  Russian: {
    native: "Русский",
    iso: "ru",
    examples: [
      ["Hello, how are you?", "Здравствуйте, как дела?"],
      ["こんにちは。", "Здравствуйте."],
    ],
  },
  Arabic: {
    native: "العربية",
    iso: "ar",
    examples: [
      ["Hello, how are you?", "مرحباً، كيف حالك؟"],
      ["こんにちは。", "مرحباً."],
    ],
  },
  German: {
    native: "Deutsch",
    iso: "de",
    examples: [
      ["Hello, how are you?", "Hallo, wie geht es dir?"],
      ["こんにちは。", "Hallo."],
    ],
  },
  Italian: {
    native: "Italiano",
    iso: "it",
    examples: [
      ["Hello, how are you?", "Ciao, come stai?"],
      ["こんにちは。", "Ciao."],
    ],
  },
};

function sendSessionUpdate(dc) {
  // gpt-realtime-translate モデルでは target language の動的変更のみサポート
  const target = $("targetLang").value;
  const targetIso = LANG_INFO[target]?.iso || "ja";

  dc.send(JSON.stringify({
    type: "session.update",
    session: {
      audio: {
        output: { language: targetIso },
      },
    },
  }));
}

const SILENCE_COMMIT_MS = 1500;  // この時間 delta が来なかったら履歴コミット

function startNewUtteranceIfNeeded() {
  if (state.awaitingNextUtterance) {
    state.currentTranscript = "";
    state.currentTranslation = "";
    state.awaitingNextUtterance = false;
    state.historyAppendedForUtterance = false;
  }
}

function handleRealtimeEvent(event) {
  // 入力音声の聞き取り（source）
  if (event.type === "session.input_transcript.delta" && event.delta) {
    startNewUtteranceIfNeeded();
    state.currentTranscript += event.delta;
    $("transcript").textContent = state.currentTranscript;
    scheduleCommit();
    return;
  }

  // 翻訳結果（target）
  if (event.type === "session.output_transcript.delta" && event.delta) {
    startNewUtteranceIfNeeded();
    state.currentTranslation += event.delta;
    setTranslationText(state.currentTranslation);
    scheduleCommit();
    return;
  }

  // 旧モデル互換イベント（来る場合に備えて残す）
  if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
    startNewUtteranceIfNeeded();
    state.currentTranscript += event.delta;
    $("transcript").textContent = state.currentTranscript;
    scheduleCommit();
    return;
  }

  if (event.type === "error") {
    console.error(event);
    setBadge("エラー", "error");
    setStatus((event.error && event.error.message) || "Realtime APIでエラーが発生しました。");
  }
}

// 沈黙検出で履歴にコミット（gpt-realtime-translate は明示的な完了イベントを送らない）
function scheduleCommit() {
  if (state.commitTimer) clearTimeout(state.commitTimer);
  state.commitTimer = setTimeout(() => {
    commitUtterance();
  }, SILENCE_COMMIT_MS);
}

function commitUtterance() {
  state.commitTimer = null;
  if (state.historyAppendedForUtterance) {
    state.awaitingNextUtterance = true;
    return;
  }
  const finalText = state.currentTranslation.trim();
  if (!finalText) {
    state.awaitingNextUtterance = true;
    return;
  }
  setTranslationText(finalText);
  appendHistory(state.currentTranscript, finalText);
  state.historyAppendedForUtterance = true;
  state.awaitingNextUtterance = true;
}

function appendHistory(source, translation) {
  const targetLang = $("targetLang").value;
  const targetIso = LANG_INFO[targetLang]?.iso || "en";

  const item = document.createElement("div");
  item.className = "history-item";

  const replay = document.createElement("button");
  replay.type = "button";
  replay.className = "history-replay";
  replay.setAttribute("aria-label", "もう一度読み上げる");
  replay.title = "もう一度読み上げる";
  replay.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12z"/></svg>';
  replay.addEventListener("click", () => speakText(translation, targetIso, replay));

  const body = document.createElement("div");
  body.className = "history-body";
  const text = document.createElement("div");
  text.className = "history-translation";
  text.textContent = translation;
  body.appendChild(text);
  if (source) {
    const small = document.createElement("small");
    small.textContent = source;
    body.appendChild(small);
  }

  item.appendChild(replay);
  item.appendChild(body);
  $("history").prepend(item);
}

// OpenAI TTS による履歴再読み上げ。HTMLAudioElement で再生・一時停止・再開を制御
const ttsState = {
  currentBtn: null,
  audio: null,
  cache: new Map(),  // text → blob URL
};

async function speakText(text, _isoLang, btn) {
  // 同じボタンを再度押した場合は一時停止 ⇄ 再開のトグル
  if (ttsState.currentBtn === btn && ttsState.audio) {
    if (ttsState.audio.paused) {
      ttsState.audio.play();
      setBtnState(btn, "playing");
    } else {
      ttsState.audio.pause();
      setBtnState(btn, "paused");
    }
    return;
  }

  // 別ボタン押下 → 前を停止
  stopCurrentTTS();

  setBtnState(btn, "loading");
  ttsState.currentBtn = btn;

  try {
    let audioUrl = ttsState.cache.get(text);
    if (!audioUrl) {
      const res = await fetch("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `TTS失敗 (${res.status})`);
      }
      const blob = await res.blob();
      audioUrl = URL.createObjectURL(blob);
      ttsState.cache.set(text, audioUrl);
    }

    const audio = new Audio(audioUrl);
    audio.onended = () => {
      if (ttsState.currentBtn === btn) {
        setBtnState(btn, "idle");
        ttsState.currentBtn = null;
        ttsState.audio = null;
      }
    };
    audio.onerror = () => {
      setBtnState(btn, "idle");
      if (ttsState.currentBtn === btn) {
        ttsState.currentBtn = null;
        ttsState.audio = null;
      }
    };

    ttsState.audio = audio;
    await audio.play();
    setBtnState(btn, "playing");
  } catch (error) {
    console.error(error);
    setBtnState(btn, "idle");
    setStatus(`読み上げに失敗: ${error.message}`);
    ttsState.currentBtn = null;
    ttsState.audio = null;
  }
}

function stopCurrentTTS() {
  if (ttsState.audio) {
    ttsState.audio.pause();
    ttsState.audio = null;
  }
  if (ttsState.currentBtn) {
    setBtnState(ttsState.currentBtn, "idle");
    ttsState.currentBtn = null;
  }
}

function setBtnState(btn, mode) {
  if (!btn) return;
  btn.classList.remove("playing", "paused", "loading");
  if (mode !== "idle") btn.classList.add(mode);
  // アイコン差し替え
  const icon = btn.querySelector("svg");
  if (icon) icon.innerHTML = ICONS[mode] || ICONS.idle;
}

const ICONS = {
  idle:    '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12z"/>',
  loading: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="12 6" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle>',
  playing: '<path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  paused:  '<path fill="currentColor" d="M8 5v14l11-7z"/>',
};

function stopTranslation() {
  state.dc?.close();
  state.pc?.close();
  state.micStream?.getTracks().forEach((track) => track.stop());
  state.pc = null;
  state.dc = null;
  state.micStream = null;
  state.connected = false;
  state.currentTranslation = "";
  state.currentTranscript = "";
  if (state.commitTimer) {
    clearTimeout(state.commitTimer);
    state.commitTimer = null;
  }
  setTranslationText("開始すると、ここに翻訳字幕が出ます。", { placeholder: true });
  $("transcript").textContent = "— 元の音声 —";
  setControls(false);
  setBadge("停止中", "idle");
  setStatus("停止しました。");
}

function setControls(isLive) {
  $("startBtn").disabled = isLive;
  $("stopBtn").disabled = !isLive;
  // 言語は翻訳中も切り替え可能（session.update で即時反映）
}

function setBusy(isBusy, message) {
  $("startBtn").disabled = isBusy || state.connected;
  if (message) setStatus(message);
}

function setBadge(text, mode) {
  const badge = $("connectionBadge");
  badge.className = `status-banner ${mode}`;
  const label = badge.querySelector(".status-banner-text");
  if (label) label.textContent = text;
  else badge.textContent = text;
}

function setStatus(message) {
  $("status").textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}
