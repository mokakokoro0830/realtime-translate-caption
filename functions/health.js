// Cloudflare Pages Functions: GET /health
// 動作確認用。OPENAI_API_KEY が登録されているかも返す（鍵そのものは返さない）。

export function onRequestGet(context) {
  const { env } = context;
  return new Response(
    JSON.stringify({
      ok: true,
      model: env.OPENAI_TRANSLATE_MODEL || "gpt-realtime-translate",
      apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
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
