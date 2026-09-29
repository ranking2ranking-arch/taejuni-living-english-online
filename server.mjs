import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const WEEKLY_TEMPLATE = path.join(__dirname, "templates", "weekly-template.xlsx");

function send(
  res,
  status,
  data,
  type = "application/json; charset=utf-8"
) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control":
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });

  if (Buffer.isBuffer(data)) {
    res.end(data);
  } else if (typeof data === "string") {
    res.end(data);
  } else {
    res.end(JSON.stringify(data));
  }
}

async function readBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
  }

  return body;
}


function previousMonday(weekStart){
  const d=new Date(String(weekStart)+"T00:00:00");
  if(Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate()-7);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function xmlEscape(s){
  return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function setSharedString(xml,index,value){
  const re=new RegExp(`<si>.*?<\\/si>`,'gs');
  let i=0;
  return xml.replace(re,(match)=>{
    if(i++!==index) return match;
    return `<si><t xml:space="preserve">${xmlEscape(String(value??"")).replace(/\\n/g,"&#10;")}</t></si>`;
  });
}
function weekLabelFromMonday(weekStart){
  const d=new Date(String(weekStart)+"T00:00:00");
  if(Number.isNaN(d.getTime())) return "주간";
  // 프로젝트 기준: 주차는 '월요일이 속한 달'을 기준으로 계산합니다.
  // 따라서 2026-09-28은 9월 5주차입니다.
  const first=new Date(d.getFullYear(),d.getMonth(),1);
  const firstMonday=new Date(first);
  const day=first.getDay(); // Sun=0 ... Sat=6
  const diff=(day+6)%7;      // 1일 이전의 가장 가까운 월요일까지
  firstMonday.setDate(first.getDate()-diff);
  const n=Math.floor((d-firstMonday)/(7*24*60*60*1000))+1;
  return `${d.getMonth()+1}월 ${n}주차`;
}

function historicalPlanFor(start){
  if(start==="2026-09-21") return {
    title:"🌱 태준이 생활영어 4주차",
    goal:"이번 주 목표: 원하는 것 말하기 + 내 상태 말하기",
    days:[
      {day:"월",focus:"💧 오늘의 표현",target:"I want water.",situation:"물 마실 때",momSays:"Do you want some water?",expectedResponse:"Yes. → I want water."},
      {day:"화",focus:"🍪 오늘의 표현",target:"I want juice.\nI want a cookie.\nI want the blue one.",situation:"간식·장난감 선택",momSays:"What do you want?\nWhich one do you want?",expectedResponse:"Juice. / Blue. → 문장으로 자연스럽게 확장"},
      {day:"수",focus:"🙅 오늘의 표현",target:"I don't want it.",situation:"먹기 싫은 것·하기 싫은 것",momSays:"Do you want this?",expectedResponse:"No. → I don't want it."},
      {day:"목",focus:"😴 오늘의 표현",target:"I'm hungry.\nI'm sleepy.\nI'm tired.",situation:"아침·식사 전·잠자리",momSays:"Are you sleepy?\nAre you hungry?\nAre you tired?",expectedResponse:"Hungry! → I'm hungry."},
      {day:"금",focus:"🌱 오늘의 표현",target:"Can I have some water?",situation:"물·간식 달라고 할 때",momSays:"What do you want?\nCan I have some water?",expectedResponse:"기존 표현 복습 + 새 표현은 자연스럽게 노출"}
    ]
  };
  return null;
}

function buildWeeklyWorkbook(plan){
  if(!fs.existsSync(WEEKLY_TEMPLATE)) throw new Error("주간계획표 고정 양식 파일이 없습니다.");
  const zip=unzipSync(new Uint8Array(fs.readFileSync(WEEKLY_TEMPLATE)));
  let ss=strFromU8(zip["xl/sharedStrings.xml"]);
  const days=Array.isArray(plan.days)?plan.days:[];
  if(days.length!==5) throw new Error("주간계획표는 월~금 5일 계획이 필요합니다.");

  // 사용자가 확정한 '태준이 주간계획표양식 최종픽스본.xlsx'의
  // 셀/공유문자열 구조를 그대로 유지하고, 내용만 주차별로 교체합니다.
  const sharedIndexes={
    title:37,
    goal:38,
    day:[0,1,2,3,4],
    focus:[5,6,7,8,9],
    target:[10,11,12,13,14],
    situation:[15,16,17,18,19],
    mom:[43,39,40,41,42],
    expected:[44,45,46,47,48]
  };

  const values=new Map();
  values.set(sharedIndexes.title, plan.title || "🌱 태준이 생활영어");
  values.set(sharedIndexes.goal, `이번 주 목표: ${plan.goal || "생활 속에서 자연스럽게 영어로 말하기"}`);

  days.forEach((d,i)=>{
    values.set(sharedIndexes.day[i], ["월요일","화요일","수요일","목요일","금요일"][i]);
    values.set(sharedIndexes.focus[i], `【집중】\n${d.focus||""}`);
    values.set(sharedIndexes.target[i], `【목표 문장】\n${d.target||""}`);
    values.set(sharedIndexes.situation[i], `【사용 상황】\n${d.situation||""}`);
    values.set(sharedIndexes.mom[i], `[엄마가 해줄 말]\n${d.momSays||""}`);
    values.set(sharedIndexes.expected[i], `[태준이 예상 반응]\n${d.expectedResponse||""}`);
  });

  for(const [i,v] of values) ss=setSharedString(ss, i, v);
  zip["xl/sharedStrings.xml"]=strToU8(ss);

  // 시트 이름만 주차에 맞춰 바꾸고, 서식/병합/인쇄 설정은 템플릿 그대로 둡니다.
  const sheetName=String(plan.sheetName||"주간계획표");
  let workbookXml=strFromU8(zip["xl/workbook.xml"]);
  workbookXml=workbookXml.replace(/name="[^"]*계획표"/, `name="${xmlEscape(sheetName)}"`);
  workbookXml=workbookXml.replace(/Target="worksheets\/[^\"]+\.xml"/, 'Target="worksheets/sheet1.xml"');
  zip["xl/workbook.xml"]=strToU8(workbookXml);
  return Buffer.from(zipSync(zip,{level:6}));
}

function supaHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function supa(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "SUPABASE_URL 또는 SUPABASE_ANON_KEY가 없습니다."
    );
  }

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${pathname}`,
    {
      ...options,
      headers: supaHeaders(options.headers || {}),
    }
  );

  const text = await r.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    throw new Error(
      data?.message ||
        data?.hint ||
        data?.error_description ||
        data?.error ||
        "Supabase 오류"
    );
  }

  return data;
}

const server = http.createServer(async (req, res) => {
  try {
    /*
     * --------------------------------
     * 홈페이지 및 정적 파일
     * --------------------------------
     */

    if (req.method === "GET") {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const pathname = decodeURIComponent(url.pathname);

      const file =
        pathname === "/"
          ? "index.html"
          : pathname.replace(/^\/+/, "");

      const root = path.resolve(publicDir);
      const full = path.resolve(publicDir, file);

      if (
        full === root ||
        full.startsWith(root + path.sep)
      ) {
        if (
          fs.existsSync(full) &&
          fs.statSync(full).isFile()
        ) {
          const ext = path.extname(full);

          const types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
          };

          return send(
            res,
            200,
            fs.readFileSync(full),
            types[ext] || "application/octet-stream"
          );
        }
      }
    }

    /*
     * --------------------------------
     * 전체 데이터 가져오기
     * --------------------------------
     */

    if (
      req.method === "GET" &&
      req.url === "/api/data"
    ) {
      const [records, notes] = await Promise.all([
        supa(
          "records?select=*&order=created_at.desc"
        ),
        supa(
          "notes?select=*&order=created_at.desc"
        ),
      ]);

      return send(res, 200, {
        records,
        notes,
      });
    }

    /*
     * --------------------------------
     * 기록장 기록 추가
     * --------------------------------
     */

    if (
      req.method === "POST" &&
      req.url === "/api/records"
    ) {
      const item = JSON.parse(await readBody(req));

      const rows = await supa("records", {
        method: "POST",
        body: JSON.stringify(item),
      });

      return send(res, 201, rows[0]);
    }

    /*
     * --------------------------------
     * 기록장 기록 삭제
     * --------------------------------
     */

    if (
      req.method === "DELETE" &&
      req.url.startsWith("/api/records/")
    ) {
      const id = decodeURIComponent(
        req.url.split("/").pop()
      );

      await supa(
        `records?id=eq.${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        }
      );

      return send(res, 200, {
        ok: true,
      });
    }

    /*
     * --------------------------------
     * 영어노트 추가
     * --------------------------------
     */

    if (
      req.method === "POST" &&
      req.url === "/api/notes"
    ) {
      const item = JSON.parse(await readBody(req));

      const rows = await supa("notes", {
        method: "POST",
        body: JSON.stringify(item),
      });

      return send(res, 201, rows[0]);
    }

    /*
     * --------------------------------
     * 영어노트 삭제
     * --------------------------------
     */

    if (
      req.method === "DELETE" &&
      req.url.startsWith("/api/notes/")
    ) {
      const id = decodeURIComponent(
        req.url.split("/").pop()
      );

      await supa(
        `notes?id=eq.${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        }
      );

      return send(res, 200, {
        ok: true,
      });
    }


    /*
     * --------------------------------
     * 주간계획표 인쇄용 엑셀 다운로드
     * --------------------------------
     */
    if (req.method === "GET" && req.url.startsWith("/api/weekly-plan.xlsx")) {
      const url=new URL(req.url, `http://${req.headers.host||"localhost"}`);
      const weekStart=url.searchParams.get("weekStart");
      const prev=previousMonday(weekStart);
      if(!prev) return send(res,400,{error:"weekStart가 올바르지 않습니다."});

      const historical=historicalPlanFor(weekStart);
      let result=null;
      if(!historical){
        try{
          const rows=await supa(`weekly_analysis?week_start=eq.${encodeURIComponent(prev)}&select=result&limit=1`);
          result=rows[0]?.result||null;
        }catch(e){
          return send(res,500,{error:e.message});
        }
      }

      let next=historical?.days || result?.nextWeekPlan;
      if(!Array.isArray(next)||next.length!==5){
        if(weekStart==="2026-09-28"){
          next=[
            {day:"월",focus:"원하는 것",target:"I want some snacks.\nI want a cookie.",situation:"간식을 먹기 전이나 간식 준비 중",momSays:"What do you want?\nDo you want a snack?",expectedResponse:"I want a cookie.\nI want some snacks."},
            {day:"화",focus:"원하는 것 / 필요한 것",target:"I need some grapes.\nI need some water.",situation:"간식이나 음료가 필요할 때",momSays:"What do you need?\nDo you need some grapes?",expectedResponse:"I need some grapes.\nI need some water."},
            {day:"수",focus:"발견하고 설명하기",target:"What is it?\nIt's a pumpkin.",situation:"그림책이나 주변에서 익숙한 것을 발견했을 때",momSays:"What is it?\nWhat did you find?",expectedResponse:"It's a pumpkin.\nIt's a ___!"},
            {day:"목",focus:"질문하기",target:"What do you want?\nI want the blue one.",situation:"여러 가지 중에서 고를 때",momSays:"What do you want?\nWhich one do you want?",expectedResponse:"I want the blue one.\nI want this one."},
            {day:"금",focus:"일상 대화",target:"Do you want some water?\nYes, please. / I'm good.",situation:"물을 주거나 간식을 챙겨줄 때",momSays:"Do you want some water?\nDo you want some more?",expectedResponse:"Yes, please.\nI'm good."}
          ];
        } else {
          return send(res,404,{error:"이 주차의 계획표가 아직 만들어지지 않았어요. 이전 주 일요일 AI 분석을 먼저 완료해주세요."});
        }
      }
      const label=weekLabelFromMonday(weekStart);
      const plan={title:`🌱 태준이 생활영어 ${label}`,sheetName:`${label} 계획표`,goal:result?.nextGoal||"생활 속에서 자연스럽게 영어로 말하기",days:next};
      const file=buildWeeklyWorkbook(plan);
      res.writeHead(200,{
        "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(`태준이_생활영어_${label}_인쇄용.xlsx`)}`,
        "Content-Length":file.length,
        "Cache-Control":"no-store"
      });
      return res.end(file);
    }

    /*
     * --------------------------------
     * 저장된 주간 분석 가져오기
     * --------------------------------
     */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/analysis/")
    ) {
      const weekStart = decodeURIComponent(
        req.url.split("/").pop()
      );

      const rows = await supa(
        `weekly_analysis?week_start=eq.${encodeURIComponent(
          weekStart
        )}&select=result&limit=1`
      );

      return send(
        res,
        200,
        rows[0]?.result || null
      );
    }

    /*
     * --------------------------------
     * AI 주간 분석
     * --------------------------------
     */

    if (
      req.method === "POST" &&
      req.url === "/api/analyze-week"
    ) {
      const input = JSON.parse(
        await readBody(req)
      );

      if (!process.env.OPENAI_API_KEY) {
        return send(res, 500, {
          error:
            "OPENAI_API_KEY가 없습니다.",
        });
      }

      const records = Array.isArray(
        input.records
      )
        ? input.records
        : [];

      const weekLabel = String(
        input.weekLabel || ""
      );

      const weekStart = String(
        input.weekStart || ""
      );

      /*
       * 이미 이번 주 분석이 저장되어 있으면
       * OpenAI API를 다시 호출하지 않음
       */

      const existing = await supa(
        `weekly_analysis?week_start=eq.${encodeURIComponent(
          weekStart
        )}&select=result&limit=1`
      );

      if (existing[0]?.result) {
        return send(
          res,
          200,
          existing[0].result
        );
      }

      /*
       * 새로운 AI 분석은 일요일에만 실행
       */

     const koreaDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  weekday: "short",
}).format(new Date());

if (koreaDay !== "Sun") {
  return send(res, 403, {
    error:
      "새 AI 주간분석은 한국시간 기준 일요일에만 실행할 수 있어요.",
  });
}

      /*
       * OpenAI API 호출
       */

      const response = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },

          body: JSON.stringify({
            model: "gpt-5.6-luna",

            input: [
              {
                role: "system",

                content: `
You are Taejun's weekly English coach.

Taejun is a 5-year-old Korean child.

Analyze ONLY the supplied weekly record data.
Do not invent events or abilities.

Use these 8 areas:

1 원하는 것
2 좋아하고 싫어하기
3 발견하고 설명하기
4 위치
5 행동
6 감정·상태
7 질문하기
8 일상 대화

Identify:

- what was actually demonstrated
- what is emerging
- what needs practice
- the next week's 1-2 focus areas based on evidence

Keep the plan natural for a parent to use in daily life.
Do not make drills or worksheets.

For nextWeekPlan, make the five days feel like real-life Korean parent-child conversations, not textbook exercises.
- target: include 1-3 natural English examples that Taejun could actually say in that situation. Vary forms when natural (for example I want..., Can I have..., I don't want..., I need..., This one..., etc.).
- momSays: use varied, natural parent language that would genuinely occur in the situation. Do not repeat the same question pattern every day.
- expectedResponse: include 2-3 plausible natural child responses, with short answers allowed and a natural expanded sentence when appropriate. Do not make every day use the same response pattern.
- situation: describe a concrete everyday moment that naturally creates a reason to use the target language.
- Keep the language age-appropriate for a 5-year-old and useful in ordinary home/outdoor routines.

Return ONLY valid JSON.

The JSON must have these keys:

summary
areas
spontaneous
newExpressions
difficulties
nextFocus
nextGoal
targetSentences
nextWeekPlan

areas must contain exactly 8 objects.

Each area object must contain:

name
evidence
level

level must be one of:

강함
형성중
노출중
기록없음

nextFocus must contain 1 or 2 area names.

targetSentences must contain exactly 3 English sentences.

nextWeekPlan must contain exactly 5 objects.

Each day object must contain:

day
focus
target
situation
momSays
expectedResponse
`,
              },

              {
                role: "user",

                content: JSON.stringify({
                  weekLabel,
                  records,
                }),
              },
            ],
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return send(res, response.status, {
          error:
            data?.error?.message ||
            "OpenAI API 오류가 발생했습니다.",
        });
      }

      /*
       * OpenAI Responses API 결과에서
       * 실제 텍스트만 추출
       */

      const text = (data.output || [])
        .flatMap(
          (item) => item.content || []
        )
        .filter(
          (item) =>
            item.type === "output_text"
        )
        .map(
          (item) => item.text
        )
        .join("");

      let result;

      try {
        result = JSON.parse(text);
      } catch {
        return send(res, 500, {
          error:
            "AI 분석 결과를 JSON으로 읽지 못했습니다.",
          raw: text,
        });
      }

      /*
       * 분석 결과를 Supabase에 저장
       */

      await supa("weekly_analysis", {
        method: "POST",

        body: JSON.stringify({
          week_start: weekStart,
          week_label: weekLabel,
          result,
        }),
      });

      return send(res, 200, result);
    }

    /*
     * --------------------------------
     * 존재하지 않는 주소
     * --------------------------------
     */

    return send(
      res,
      404,
      "Not found",
      "text/plain; charset=utf-8"
    );
  } catch (err) {
    console.error(err);

    return send(res, 500, {
      error:
        err.message ||
        "서버 오류",
    });
  }
});

/*
 * --------------------------------
 * 서버 시작
 * --------------------------------
 */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `태주니 생활영어 online server: ${PORT}`
    );
  }
);