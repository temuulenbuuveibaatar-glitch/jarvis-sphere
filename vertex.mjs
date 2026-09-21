import { GoogleGenAI } from '@google/genai';

const project = () => process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
const location = () => process.env.GOOGLE_CLOUD_LOCATION || 'global';

export function vertexStatus() {
  return { configured: Boolean(project()), location: location(), model: process.env.JARVIS_VERTEX_MODEL || 'gemini-2.5-flash' };
}

export function vertexRequest(messages, signal, { model, mode = 'chat' } = {}) {
  const systemInstruction = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  const contents = messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
  return {
    model: model || process.env.JARVIS_VERTEX_MODEL || 'gemini-2.5-flash',
    contents,
    config: { systemInstruction, abortSignal: signal, ...(mode === 'research' ? { tools: [{ googleSearch: {} }] } : {}) },
  };
}

export async function vertexReply(messages, signal, options = {}) {
  if (!project()) throw new Error('Set GOOGLE_CLOUD_PROJECT before using Vertex AI.');
  const client = new GoogleGenAI({ vertexai: true, project: project(), location: location(), httpOptions: { timeout: 180000 } });
  const response = await client.models.generateContent(vertexRequest(messages, signal, options));
  const text = response.text?.trim();
  if (!text) throw new Error('Vertex AI returned no assistant text.');
  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map(chunk => chunk.web).filter(source => source?.uri)
    .filter((source, index, all) => all.findIndex(item => item.uri === source.uri) === index) || [];
  return sources.length ? `${text}\n\nSources:\n${sources.slice(0, 8).map(source => `- ${source.title || source.uri}: ${source.uri}`).join('\n')}` : text;
}
