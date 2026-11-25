// ShiftCraft AI — Taiwan ID / ARC / Bank Passbook AI Vision OCR Edge Function
// Deploy in Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor → name: "hr-ocr"
// Turn OFF "Verify JWT" in Details tab.
// Required Secret: GEMINI_API_KEY (free key from https://aistudio.google.com/apikey)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function buildPrompt(docType: string): string {
  if (docType === 'ID_FRONT') {
    return [
      '你是一位專精台灣人事建檔的證件辨識專家。請仔細辨識這張「中華民國國民身分證（正面）」照片（即使照片有旋轉、歪斜或反光也請正確讀取）。',
      '請只回傳純 JSON 物件（不要 markdown），欄位如下（無法辨識的欄位請回傳空字串 ""）：',
      '{',
      '  "name": "中文姓名（繁體中文、去除空格，例：王小明）",',
      '  "nationalId": "10碼身分證統一編號（大寫英文字母開頭+9位數字，例：A123456789）",',
      '  "birthDate": "出生年月日，務必轉換為台灣民國年 3碼格式 YYY/MM/DD（例：民國85年5月12日 → 085/05/12）"',
      '}',
    ].join('\n');
  }
  if (docType === 'ID_BACK') {
    return [
      '你是一位專精台灣人事建檔的證件辨識專家。請仔細辨識這張「中華民國國民身分證（反面）」照片（即使照片有旋轉、歪斜或反光也請正確讀取）。',
      '請只回傳純 JSON 物件（不要 markdown），欄位如下（無法辨識請回傳空字串 ""）：',
      '{',
      '  "registeredAddress": "完整戶籍住址（繁體中文，去除多餘空白，例：台北市中山區南京西路12號3樓）",',
      '  "emergencyName": "若配偶欄有姓名則填「姓名(配偶)」，否則若父或母欄有姓名則填「姓名(父)」或「姓名(母)」，無則空字串"',
      '}',
    ].join('\n');
  }
  if (docType === 'ARC_FRONT') {
    return [
      '你是一位專精台灣人事建檔的外僑居留證（ARC）辨識專家。請仔細辨識這張居留證正面照片。',
      '請只回傳純 JSON 物件（不要 markdown），欄位如下（無法辨識請回傳空字串 ""）：',
      '{',
      '  "name": "中文姓名（若無中文則填英文全名）",',
      '  "nationalId": "10碼統一證號（大寫英文字母開頭，共10碼）",',
      '  "birthDate": "出生日期，請將西元年減1911轉為台灣民國年 YYY/MM/DD（例：1998/09/03 → 087/09/03）",',
      '  "arcExpiryDate": "居留期限西元格式 YYYY-MM-DD（例：2028-06-30）"',
      '}',
    ].join('\n');
  }
  if (docType === 'ARC_BACK') {
    return [
      '請仔細辨識這張台灣外僑居留證（ARC）反面照片的居留地址。',
      '請只回傳純 JSON 物件（不要 markdown）：',
      '{ "registeredAddress": "完整在台居留地址（繁體中文，無多餘空白）" }',
    ].join('\n');
  }
  if (docType === 'BANK_PASSBOOK') {
    return [
      '你是一位專精台灣銀行與郵局存摺封面辨識的專家。請仔細辨識這張存摺封面或網銀帳號截圖（即使照片有旋轉、歪斜或反光也請正確讀取）。',
      '請只回傳純 JSON 物件（不要 markdown），欄位如下（無法辨識請回傳空字串 ""）：',
      '{',
      '  "bankCode": "3碼台灣金融機構代碼（例：822=中國信託, 013=國泰世華, 808=玉山, 812=台新, 700=中華郵政/郵局, 012=台北富邦, 004=臺灣銀行, 005=土地銀行, 006=合作金庫, 007=第一銀行, 008=華南銀行, 009=彰化銀行, 011=上海商銀, 017=兆豐, 050=臺灣企銀, 052=渣打, 081=匯豐, 103=新光, 803=聯邦, 805=遠東, 806=元大, 807=永豐, 809=凱基, 810=星展, 823=將來銀行, 824=LINE Bank, 826=樂天）",',
      '  "bankName": "銀行中文名稱",',
      '  "accountNumber": "完整存摺帳號純數字（務必去除所有連字號-與空格，若為郵局700則為局號7碼+帳號7碼共14碼純數字）",',
      '  "accountHolder": "存摺戶名（中文姓名，若無則空字串）"',
      '}',
    ].join('\n');
  }
  return [
    '請辨識這張台灣勞動部工作許可函照片，只回傳純 JSON（不要 markdown）：',
    '{ "workPermitNo": "發文字號", "workPermitExpiry": "許可期限 YYYY-MM-DD" }',
  ].join('\n');
}

async function callGeminiModel(model: string, apiKey: string, parts: Record<string, unknown>[], jsonMode: boolean) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig: Record<string, unknown> = { temperature: 0.1 };
  if (jsonMode) generationConfig.responseMimeType = 'application/json';
  if (model.startsWith('gemini-2.5')) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }

  const apiKey = (Deno.env.get('GEMINI_API_KEY') || '').trim();
  if (!apiKey) {
    return jsonResp({
      ok: false,
      code: 'MISSING_API_KEY',
      error: '尚未在 Supabase Secrets 設定 GEMINI_API_KEY',
    }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];

  // 連線健康檢查模式（不需傳照片）
  if (body.ping === true) {
    let lastErr = '';
    for (const model of models) {
      try {
        const r = await callGeminiModel(model, apiKey, [{ text: 'Reply OK' }], false);
        if (r.ok) return jsonResp({ ok: true, engine: model, message: `Gemini AI 視覺辨識已連線（${model}）` });
        lastErr = `${model} HTTP ${r.status}: ${r.text.slice(0, 180)}`;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    return jsonResp({ ok: false, code: 'GEMINI_API_ERROR', error: lastErr }, 502);
  }

  const docType = String(body.docType || 'ID_FRONT');
  const rawBase64 = String(body.imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
  const mimeType = /^image\/(jpeg|jpg|png|webp)$/i.test(String(body.mimeType || ''))
    ? String(body.mimeType)
    : 'image/jpeg';

  if (!rawBase64 || rawBase64.length < 100) {
    return jsonResp({ ok: false, code: 'EMPTY_IMAGE', error: '未提供有效的證件照片' }, 400);
  }

  const prompt = buildPrompt(docType);
  const parts = [
    { text: prompt },
    { inlineData: { mimeType, data: rawBase64 } },
  ];

  let lastStatus = 502;
  let lastError = '';

  for (const model of models) {
    try {
      const r = await callGeminiModel(model, apiKey, parts, true);
      if (!r.ok) {
        lastStatus = r.status;
        lastError = `${model} HTTP ${r.status}: ${r.text.slice(0, 220)}`;
        continue;
      }
      const geminiJson = JSON.parse(r.text);
      const textOut = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = String(textOut)
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const braceMatch = cleaned.match(/\{[\s\S]*\}/);
        if (braceMatch) parsed = JSON.parse(braceMatch[0]);
      }

      return jsonResp({ ok: true, engine: model, data: parsed });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return jsonResp({
    ok: false,
    code: 'GEMINI_API_ERROR',
    status: lastStatus,
    error: lastError || 'Gemini API 呼叫失敗',
  }, 502);
});
