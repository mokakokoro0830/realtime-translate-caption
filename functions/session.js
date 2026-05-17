// Cloudflare Pages Functions: POST /session
// gpt-realtime-translate モデル用：2段階認証で WebRTC SDP を交換する
//   ① OpenAI に client_secret を発行依頼（target language を指定）
//   ② client_secret を使って SDP を /realtime/translations/calls に POST
//   ③ SDP answer をブラウザに返す

import { APP_PAUSED, PAUSED_MESSAGE } from "./_config.js";

const TRANSLATE_MODEL = "gpt-realtime-translate";
const TRANSCRIPTION_MODEL = "gpt-realtime-whisper";

export async function onRequestPost(context) {
  const { request, env } = context;

  // 一時停止中
  if (APP_PAUSED) {
    return jsonResponse(503, { error: PAUSED_MESSAGE, paused: true });
  }

  // Origin チェック
  const originCheck = verifyOrigin(request);
  if (!originCheck.ok) return jsonResponse(403, { error: originCheck.error });

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, {
      error: "OPENAI_API_KEY が未設定です。Cloudflare Pages の環境変数（Secret）に登録してください。",
    });
  }

  const url = new URL(request.url);
  const targetLang = (url.searchParams.get("lang") || "ja").toLowerCase();

  const sdp = await request.text();
  if (!sdp || !sdp.includes("v=0")) {
    return jsonResponse(400, { error: "WebRTC SDP が見つかりません。" });
  }

  // ① client_secret を作成
  const secretResp = await fetch(
    "https://api.openai.com/v1/realtime/translations/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          model: TRANSLATE_MODEL,
          audio: {
            input: {
              transcription: { model: TRANSCRIPTION_MODEL },
              noise_reduction: { type: "near_field" },
            },
            output: { language: targetLang },
          },
        },
      }),
    },
  );

  if (!secretResp.ok) {
    const detail = await secretResp.text();
    return jsonResponse(secretResp.status, {
      error: "翻訳セッションの作成に失敗しました。",
      detail: detail.slice(0, 1000),
    });
  }

  const secretData = await secretResp.json();
  const clientSecret = secretData?.value || secretData?.client_secret?.value;
  if (!clientSecret) {
    return jsonResponse(500, { error: "client_secret が取得できませんでした。" });
  }

  // ② SDP を交換
  const sdpResp = await fetch(
    "https://api.openai.com/v1/realtime/translations/calls",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: sdp,
    },
  );

  const answer = await sdpResp.text();
  if (!sdpResp.ok) {
    return jsonResponse(sdpResp.status, {
      error: "OpenAI Realtime セッション作成に失敗しました。",
      detail: answer.slice(0, 1000),
    });
  }

  return new Response(answer, {
    status: 200,
    headers: {
      "Content-Type": "application/sdp",
      "Cache-Control": "no-store",
    },
  });
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function verifyOrigin(request) {
  const origin = request.headers.get("Origin");
  const host = request.headers.get("Host");
  if (!host) return { ok: false, error: "Host ヘッダがありません。" };
  if (!origin) return { ok: false, error: "このエンドポイントはブラウザからのみ呼び出せます。" };
  try {
    if (new URL(origin).host !== host) {
      return { ok: false, error: "別ドメインからの呼び出しは許可されていません。" };
    }
  } catch {
    return { ok: false, error: "Origin が不正です。" };
  }
  return { ok: true };
}
