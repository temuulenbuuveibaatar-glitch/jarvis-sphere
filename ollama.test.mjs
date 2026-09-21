import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ollamaBase, ollamaStatus, ollamaReply } from './ollama.mjs';
test('local Ollama discovery, thinking payload, response and endpoint restrictions', async () => {
 const previous = process.env.JARVIS_OLLAMA_BASE_URL;
 const server = http.createServer(async (req,res) => {
  res.setHeader('Content-Type','application/json');
  if(req.url === '/api/tags') return res.end(JSON.stringify({models:[{name:'test:local'},{name:'test:cloud'}]}));
  let body=''; for await (const chunk of req) body+=chunk;
  const data=JSON.parse(body); assert.equal(data.think,true); assert.equal(data.stream,false);
  res.end(JSON.stringify({message:{content:'Local answer'}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  process.env.JARVIS_OLLAMA_BASE_URL=`http://127.0.0.1:${server.address().port}`;
  assert.deepEqual((await ollamaStatus()).models,['test:local']);
  assert.equal(await ollamaReply([{role:'user',content:'test'}],undefined,{model:'test:local',mode:'think'}),'Local answer');
  await assert.rejects(ollamaReply([],undefined,{model:'test:cloud'}));
  process.env.JARVIS_OLLAMA_BASE_URL='https://example.com'; assert.throws(ollamaBase);
 } finally { if(previous===undefined) delete process.env.JARVIS_OLLAMA_BASE_URL; else process.env.JARVIS_OLLAMA_BASE_URL=previous; await new Promise(resolve=>server.close(resolve)); }
});
