import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  if (Buffer.isBuffer(data)) return res.end(data);
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET") {
      const file = req.url === "/" ? "index.html" : req.url.replace(/^\/+/, "");
      const full = path.normalize(path.join(publicDir, file));
      if (full.startsWith(publicDir) && fs.existsSync(full) && fs.statSync(full).isFile()) {
        const ext = path.extname(full);
        const types = {
          ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",
          ".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",
          ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml"
        };
        return send(res, 200, fs.readFileSync(full), types[ext] || "application/octet-stream");
      }
      return send(res, 404, "Not found", "text/plain; charset=utf-8");
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const input = JSON.parse(await readBody(req));
      if (!process.env.OPENAI_API_KEY) {
        return send(res, 500, {error:"OPENAI_API_KEY가 없습니다. .env 파일을 확인해주세요."});
      }
      const response = await fetch("https://api.openai.com/v1/responses", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
        },
        body:JSON.stringify({
          model:"gpt-5.6-luna",
          input:[
            {role:"system",content:"You are a natural American English coach for a Korean parent speaking to a 5-year-old child named Taejun. Translate the Korean sentence into one natural, warm, everyday American English sentence a parent would actually say to a 5-year-old. Return JSON with keys: english, pronunciation, explanation. pronunciation should be Korean-friendly pronunciation. explanation should be a very short Korean explanation."},
            {role:"user",content:String(input.text||"")}
          ]
        })
      });
      const data = await response.json();
      if (!response.ok) return send(res,response.status,{error:data?.error?.message||"OpenAI API 오류가 발생했습니다."});
      const text = (data.output || []).flatMap(item => item.content || [])
        .filter(item => item.type === "output_text").map(item => item.text).join("");
      let result;
      try { result = JSON.parse(text); }
      catch { result = {english:text,pronunciation:"",explanation:""}; }
      return send(res,200,result);
    }
    return send(res,404,"Not found","text/plain; charset=utf-8");
  } catch (err) {
    return send(res,500,{error:err.message||"서버 오류"});
  }
});
server.listen(PORT,()=>console.log(`태주니 생활영어: http://localhost:${PORT}`));
