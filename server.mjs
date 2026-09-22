import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

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