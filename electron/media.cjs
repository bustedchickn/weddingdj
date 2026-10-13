const fs = require('node:fs');
const { stat } = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const mime = {'.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.flac':'audio/flac','.m4a':'audio/mp4','.aac':'audio/aac','.aif':'audio/aiff','.aiff':'audio/aiff','.opus':'audio/ogg','.wma':'audio/x-ms-wma'};
async function readAudio(file, request) {
  if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405});
  const info = await stat(file);
  if (!info.isFile() || info.size <= 0) return new Response('Empty or unavailable file',{status:404});
  const size = info.size;
  let start = 0, end = size - 1, partial = false;
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end,Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    partial = true;
  }
  const headers = {'Content-Type':mime[path.extname(file).toLowerCase()] || 'application/octet-stream','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  const body = request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(file,{start,end}));
  return new Response(body,{status:partial?206:200,headers});
}
module.exports = {readAudio};
