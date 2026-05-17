// Cloudflare Pages Functions: GET /health
// 動作確認用。一時停止状態も返す。

import { APP_PAUSED, PAUSED_MESSAGE } from "./_config.js";

export function onRequestGet(context) {
  const { env } = context;
  return new Response(
    JSON.stringify({
      ok: true,
      model: env.OPENAI_TRANSLATE_MODEL || "gpt-realtime-translate",
      apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
      paused: APP_PAUSED,
      pausedMessage: APP_PAUSED ? PAUSED_MESSAGE : null,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
