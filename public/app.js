const $ = (id) => document.getElementById(id);

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
  transcriptCompletedForUtterance: false,
  pendingHistorySourceQueue: [],  // 翻訳完了が transcription 完了より先に来た履歴 source の更新待ち列（FIFO）
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
  const response = await fetch("/session", {
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
  const source = $("sourceLang").value;
  const target = $("targetLang").value;
  const targetInfo = LANG_INFO[target] || { native: target, examples: [] };
  const sourceInfo = source !== "auto" ? LANG_INFO[source] : null;

  const sourceLine = source === "auto"
    ? "The speaker may use any language. Detect it automatically."
    : `The speaker is mainly using ${source} (${sourceInfo?.native ?? source}).`;

  const voiceOn = $("voiceOutput").checked;
  const voiceText = voiceOn
    ? `Also speak the translation aloud in ${target} only. Never speak any other language.`
    : "Do not speak. Output text only.";

  const transcriptionConfig = { model: "gpt-4o-transcribe" };
  if (sourceInfo?.iso) {
    transcriptionConfig.language = sourceInfo.iso;
  }

  const examplesText = (targetInfo.examples || [])
    .map(([src, tgt]) => `Input: "${src}" -> Output: "${tgt}"`)
    .join("\n");

  const sessionPayload = {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: [
        "You are a strict translation engine. No personality. No conversation. No commentary.",
        sourceLine,
        "",
        `=== ABSOLUTE RULES (HIGHEST PRIORITY) ===`,
        "NEVER apologize. NEVER say 'sorry', '죄송합니다', '申し訳ありません', 'lo siento', 'désolé', 'Entschuldigung', 'mi dispiace', 'desculpe', 'извините', 'ขอโทษ', 'क्षमा', 'آسف', or any equivalent in any language.",
        "NEVER ask for clarification. NEVER say 'could you repeat', 'please say again', 'I didn't catch that', or anything similar.",
        "NEVER say you cannot translate. NEVER say 'I cannot', 'I am unable', or anything implying inability.",
        "NEVER comment on the audio quality, accent, or speed. NEVER mention transcription confidence.",
        "If the input is unclear, short, or you are unsure: JUST translate whatever words you heard literally, even if it is a single word. A single word translation is fine.",
        "If you heard 'ありがとう', output just the translation of 'ありがとう' (e.g., 'Thank you', '감사합니다', 'Gracias'). DO NOT add anything.",
        "",
        `=== OUTPUT LANGUAGE ===`,
        `The output MUST be written entirely in ${target} (${targetInfo.native}).`,
        `Do NOT include any other language in the output.`,
        `Do NOT output a bilingual response. Do NOT include the source text alongside the translation.`,
        `Do NOT output an English version when the target is not English.`,
        `Even if the input is already in ${target}, output stays in ${target} (rephrase if needed, but never switch language).`,
        "",
        `=== FORMAT ===`,
        "Output ONLY the translated sentence. No prefix. No label. No quotes. No explanation. No notes.",
        "Do NOT output anything like 'Translation:', 'In English:', '日本語訳:', '翻訳：', or any meta text.",
        "Output a single line in the target language. Nothing else.",
        "",
        examplesText ? `=== EXAMPLES (target = ${target} / ${targetInfo.native}) ===\n${examplesText}` : "",
        "",
        voiceText,
      ].filter(Boolean).join("\n"),
      audio: {
        input: { transcription: transcriptionConfig },
      },
    },
  };

  dc.send(JSON.stringify(sessionPayload));
}

function handleRealtimeEvent(event) {
  if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
    if (state.awaitingNextUtterance) {
      state.currentTranscript = "";
    }
    state.transcriptCompletedForUtterance = false;
    state.currentTranscript += event.delta;
    $("transcript").textContent = state.currentTranscript;
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    const finalTranscript = event.transcript || state.currentTranscript;
    state.currentTranscript = finalTranscript;
    state.transcriptCompletedForUtterance = true;
    $("transcript").textContent = finalTranscript || "—";
    // 翻訳完了より transcription 完了が遅れて来たケース：履歴 source を順番に埋め直す
    if (finalTranscript && state.pendingHistorySourceQueue.length > 0) {
      const el = state.pendingHistorySourceQueue.shift();
      el.textContent = finalTranscript;
    }
    return;
  }

  if (isTranslationDelta(event)) {
    const delta = event.delta || event.text || event.transcript || "";
    if (!delta) return;
    if (state.awaitingNextUtterance) {
      state.currentTranslation = "";
      state.awaitingNextUtterance = false;
      state.historyAppendedForUtterance = false;
    }
    state.currentTranslation += delta;
    setTranslationText(state.currentTranslation);
    return;
  }

  if (isTranslationDone(event)) {
    // 1発話につき history.done と response.done など複数のdoneが来るため、1回だけ追加
    if (state.historyAppendedForUtterance) {
      state.awaitingNextUtterance = true;
      return;
    }
    const finalText = extractFinalText(event) || state.currentTranslation;
    if (finalText.trim()) {
      setTranslationText(finalText.trim());
      appendHistory(state.currentTranscript, finalText.trim());
      state.historyAppendedForUtterance = true;
    }
    // 次の発話のデルタが来るまで、現在の字幕を残しておく（チラつき防止）
    state.awaitingNextUtterance = true;
    return;
  }

  if (event.type === "input_audio_buffer.speech_started") {
    // 字幕は消さず、次のデルタで上書きされるまでそのまま残す
    state.awaitingNextUtterance = true;
    return;
  }

  if (event.type === "error") {
    console.error(event);
    setBadge("エラー", "error");
    setStatus((event.error && event.error.message) || "Realtime APIでエラーが発生しました。");
  }
}

function isTranslationDelta(event) {
  return [
    "response.output_text.delta",
    "response.text.delta",
    "response.audio_transcript.delta",
    "response.output_audio_transcript.delta",
  ].includes(event.type);
}

function isTranslationDone(event) {
  return [
    "response.output_text.done",
    "response.text.done",
    "response.audio_transcript.done",
    "response.output_audio_transcript.done",
    "response.done",
  ].includes(event.type);
}

function extractFinalText(event) {
  if (event.text) return event.text;
  if (event.transcript) return event.transcript;
  const outputs = (event.response && event.response.output) || [];
  for (const output of outputs) {
    for (const part of output.content || []) {
      if (part.text) return part.text;
      if (part.transcript) return part.transcript;
    }
  }
  return "";
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
  // source は常に作る（中身は空でもいい）。後から transcription.completed で埋める可能性あり
  const small = document.createElement("small");
  small.textContent = source || "";
  body.appendChild(small);

  // 翻訳完了が transcription 完了より先に来た場合、後で埋め直すためキューに保持
  if (!state.transcriptCompletedForUtterance) {
    state.pendingHistorySourceQueue.push(small);
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
  state.transcriptCompletedForUtterance = false;
  state.pendingHistorySourceQueue = [];
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
