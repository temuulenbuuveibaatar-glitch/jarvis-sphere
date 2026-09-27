const defaults = {
  gemini: 'gemini-2.5-flash-lite',
};

export function cloudLiteProvider(env = process.env) {
  const requested = String(env.JARVIS_PROVIDER || '').toLowerCase();
  if (['gemini', 'openrouter', 'bytez'].includes(requested)) return requested;
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.OPENROUTER_API_KEY) return 'openrouter';
  if (env.BYTEZ_API_KEY) return 'bytez';
  return 'gemini';
}

export function cloudLiteConfigured(provider = cloudLiteProvider(), env = process.env) {
  if (provider === 'gemini') return Boolean(env.GEMINI_API_KEY);
  if (provider === 'openrouter') return Boolean(env.OPENROUTER_API_KEY && env.JARVIS_OPENROUTER_MODEL);
  if (provider === 'bytez') return Boolean(env.BYTEZ_API_KEY && env.JARVIS_BYTEZ_MODEL);
  return false;
}

async function json(response, label) {
  if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
  return response.json();
}

export async function cloudLiteReply(messages, signal, env = process.env) {
  const provider = cloudLiteProvider(env);
  if (!cloudLiteConfigured(provider, env)) throw new Error(`Configure ${provider} before using JARVIS Cloud Lite.`);

  if (provider === 'gemini') {
    const model = env.JARVIS_GEMINI_MODEL || defaults.gemini;
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
    const contents = messages.filter(message => message.role !== 'system').map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
    const data = await json(await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}), contents }),
    }), 'Gemini');
    const reply = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!reply) throw new Error('Gemini returned no assistant text.');
    return reply;
  }

  const openrouter = provider === 'openrouter';
  const data = await json(await fetch(openrouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.bytez.com/models/v2/openai/v1/chat/completions', {
    method: 'POST', signal,
    headers: openrouter
      ? { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'JARVIS Cloud Lite' }
      : { Authorization: env.BYTEZ_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: openrouter ? env.JARVIS_OPENROUTER_MODEL : env.JARVIS_BYTEZ_MODEL, messages, max_tokens: 1200 }),
  }), openrouter ? 'OpenRouter' : 'Bytez');
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error(`${openrouter ? 'OpenRouter' : 'Bytez'} returned no assistant text.`);
  return reply;
}
