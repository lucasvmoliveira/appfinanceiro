/**
 * Netlify Function — fluxo-insights.js
 * Recebe resumo financeiro e chama a API Groq.
 * Configure: GROQ_API_KEY nas Environment Variables da Netlify.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Fluxo-Secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Use POST" }) };
  }

  const groqKey = process.env.GROQ_API_KEY;

  if (!groqKey) {
    const allKeys = Object.keys(process.env).join(", ");
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: "Servidor sem GROQ_API_KEY configurada",
        debug_vars_found: allKeys,
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const summary = body.summary;
  if (!summary || typeof summary !== "string") {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Campo summary ausente" }) };
  }

  if (summary.length > 120000) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: "Resumo muito grande" }) };
  }

  const system = `Você é um planejador financeiro pessoal objetivo. Responda em português do Brasil.
Use markdown (títulos, listas) quando ajudar a leitura.
Regras: não invente números que não apareçam no contexto; se faltar dado, diga o que falta.
Inclua: (1) visão geral do padrão de caixa, (2) riscos ou alertas, (3) até 7 sugestões práticas e priorizadas para o próximo mês.`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + groqKey,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: summary },
      ],
      temperature: 0.35,
      max_tokens: 2000,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: data.error?.message || "Erro na API Groq",
      }),
    };
  }

  const text = data.choices?.[0]?.message?.content || "";
  return { statusCode: 200, headers, body: JSON.stringify({ text }) };
};
