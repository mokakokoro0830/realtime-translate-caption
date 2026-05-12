// Cloudflare Pages Functions: POST /tts
// 履歴の再読み上げ用に OpenAI TTS を呼んで音声(mp3)を返す

export async function onRequestPost(context) {
  const { request, env } = context;

  // Origin チェック: 同一オリジンのみ許可
  const originCheck = verifyOrigin(request);
  if (!originCheck.ok) return jsonResponse(403, { error: originCheck.error });

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return jsonResponse(500, { error: "OPENAI_API_KEY が未設定です。" });

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "JSON ボディが必要です。" });
  }

  const text = (body?.text || "").trim();
  const voice = body?.voice || "shimmer";

  if (!text) return jsonResponse(400, { error: "text が空です。" });
  if (text.length > 1000) return jsonResponse(400, { error: "text が長すぎます（1000文字以内）" });

  const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: text,
      voice,
      response_format: "mp3",
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return jsonResponse(upstream.status, {
      error: "音声生成に失敗しました。",
      detail: detail.slice(0, 500),
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
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
