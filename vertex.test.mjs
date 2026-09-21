import assert from 'node:assert/strict';
import test from 'node:test';
import { vertexRequest } from './vertex.mjs';

test('Vertex research requests ground with Google Search and preserve the conversation', () => {
  const request = vertexRequest([
    { role: 'system', content: 'Be factual.' },
    { role: 'user', content: 'Latest aircraft news?' },
    { role: 'assistant', content: 'I will research it.' },
  ], undefined, { mode: 'research' });
  assert.equal(request.config.systemInstruction, 'Be factual.');
  assert.deepEqual(request.config.tools, [{ googleSearch: {} }]);
  assert.deepEqual(request.contents.map(item => item.role), ['user', 'model']);
});
