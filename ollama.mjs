export function ollamaBase() {
  const url = new URL(process.env.JARVIS_OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Ollama must use a local HTTP endpoint.');
  return url.origin;
}
export async function ollamaStatus() {
  try {
    const response = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
    if (!response.ok) throw new Error();
    const models = (await response.json()).models.map(m => m.name).filter(n => typeof n === 'string' && !n.includes('cloud'));
    return { available: true, models };
  } catch { return { available: false, models: [] }; }
}
export async function ollamaReply(messages, signal, { model, mode = 'chat' } = {}) {
  if (!model || model.includes('cloud') || model.length > 160) throw new Error('Choose an installed local model.');
  const base = ollamaBase();
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(180000)]),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, think: mode === 'think', messages }),
  });
  if (!response.ok) throw new Error(response.status === 400 ? 'This model may not support thinking. Choose another model or Chat mode.' : 'Ollama could not answer. Check the installed model and available memory.');
  const text = (await response.json()).message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Ollama returned no answer.');
  return text;
}
