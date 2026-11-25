// ShiftCraft AI — Taiwan ID / ARC / Bank Passbook AI Vision OCR Edge Function
// Deploy in Supabase Dashboard → Edge Functions → hr-ocr → paste & Deploy updates
// Details tab: Turn OFF "Verify JWT"
// Secrets: GEMINI_API_KEY (from https://aistudio.google.com/apikey)

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
      '辨識這張台灣「國民身分證（正面）」照片（即使歪斜或反光也請正確讀取）。只回傳純 JSON（無 markdown）：',
      '{"name":"中文姓名去空白","nationalId":"10碼身分證字號大寫","birthDate":"民國年3碼YYY/MM/DD，例民國72年2月16日→072/02/16"}',
    ].join('\n');
  }
  if (docType === 'ID_BACK') {
    return [
      '辨識這張台灣「國民身分證（反面）」照片。只回傳純 JSON（無 markdown）：',
      '{"registeredAddress":"完整戶籍住址繁體中文去空白","emergencyName":"配偶欄姓名(配偶)或父母欄姓名(父/母)，無則空字串"}',
    ].join('\n');
  }
  if (docType === 'ARC_FRONT') {
    return [
      '辨識這張台灣「外僑居留證（ARC）正面」。只回傳純 JSON（無 markdown）：',
      '{"name":"中文姓名或英文全名","nationalId":"10碼統一證號","birthDate":"西元減1911轉民國YYY/MM/DD","arcExpiryDate":"YYYY-MM-DD"}',
    ].join('\n');
  }
  if (docType === 'ARC_BACK') {
    return '辨識這張台灣外僑居留證反面居留地址，只回傳純 JSON：{"registeredAddress":"完整在台居留地址"}';
  }
  if (docType === 'BANK_PASSBOOK') {
    return [
      '辨識這張台灣銀行或郵局存摺封面／網銀帳號截圖。只回傳純 JSON（無 markdown）：',
      '{"bankCode":"3碼銀行代碼(822中信,013國泰,808玉山,812台新,700郵局,012富邦,004台銀,005土銀,006合庫,007一銀,008華南,009彰銀,011上海,017兆豐,050台企,052渣打,081匯豐,103新光,803聯邦,805遠東,806元大,807永豐,809凱基,810星展,823將來,824連線,826樂天)","bankName":"銀行中文名","accountNumber":"純數字帳號去連字號(郵局700為局號7碼+帳號7碼共14碼)","accountHolder":"戶名無則空字串"}',
    ].join('\n');
  }
  return '辨識台灣勞動部工作許可函，只回傳純 JSON：{"workPermitNo":"發文字號","workPermitExpiry":"YYYY-MM-DD"}';
}

const DEFAULT_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
];

function getFastThinkingConfig(model: string): Record<string, unknown> | null {
  if (/^gemini-2\.5/i.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3\.8/i.test(model)) return { thinkingLevel: 'low' };
  if (/^gemini-3\./i.test(model)) return { thinkingLevel: 'minimal' };
  return null;
}

async function discoverFallbackModels(apiKey: string, alreadyTried: Set<string>): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data?.models) ? data.models : [];
    const discovered: string[] = [];
    for (const m of list) {
      const name = String(m?.name || '').replace(/^models\//, '');
      const methods: string[] = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      if (!name || alreadyTried.has(name)) continue;
      if (!methods.includes('generateContent')) continue;
      if (!/^gemini-/i.test(name)) continue;
      if (/(tts|live|image|omni|embedding|aqa|robotics)/i.test(name)) continue;
      if (/flash/i.test(name)) discovered.push(name);
    }
    return discovered.slice(0, 3);
  } catch {
    return [];
  }
}

async function callGeminiModel(model: string, apiKey: string, parts: Record<string, unknown>[], jsonMode: boolean) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig: Record<string, unknown> = { maxOutputTokens: 512 };
  if (jsonMode) generationConfig.responseMimeType = 'application/json';
  const tc = getFastThinkingConfig(model);
  if (tc) generationConfig.thinkingConfig = tc;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 11000);
  try {
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
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function runWithAutoModel(apiKey: string, parts: Record<string, unknown>[], jsonMode: boolean) {
  const tried = new Set<string>();
  const errors: string[] = [];

  const tryList = async (models: string[]) => {
    for (const model of models) {
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        const r = await callGeminiModel(model, apiKey, parts, jsonMode);
        if (r.ok) return { ok: true as const, model, text: r.text };
        errors.push(`${model}(${r.status})`);
      } catch (e) {
        errors.push(`${model}(${e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'err'})`);
      }
    }
    return null;
  };

  const firstPass = await tryList(DEFAULT_MODELS);
  if (firstPass) return firstPass;

  const extraModels = await discoverFallbackModels(apiKey, tried);
  if (extraModels.length > 0) {
    const secondPass = await tryList(extraModels);
    if (secondPass) return secondPass;
  }

  return { ok: false as const, error: errors.join(', ') || 'No available Gemini Vision model' };
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

  if (body.ping === true) {
    const res = await runWithAutoModel(apiKey, [{ text: 'Reply OK' }], false);
    if (res.ok) {
      return jsonResp({ ok: true, engine: res.model, message: `Gemini AI 視覺辨識已連線（${res.model}）` });
    }
    return jsonResp({ ok: false, code: 'GEMINI_API_ERROR', error: res.error }, 502);
  }

  const docType = String(body.docType || 'ID_FRONT');
  const rawBase64 = String(body.imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
  const mimeType = /^image\/(jpeg|jpg|png|webp)$/i.test(String(body.mimeType || ''))
    ? String(body.mimeType)
    : 'image/jpeg';

  if (!rawBase64 || rawBase64.length < 100) {
    return jsonResp({ ok: false, code: 'EMPTY_IMAGE', error: '未提供有效的證件照片' }, 400);
  }

  const parts = [
    { text: buildPrompt(docType) },
    { inlineData: { mimeType, data: rawBase64 } },
  ];

  const res = await runWithAutoModel(apiKey, parts, true);
  if (!res.ok) {
    return jsonResp({ ok: false, code: 'GEMINI_API_ERROR', error: res.error }, 502);
  }

  try {
    const geminiJson = JSON.parse(res.text);
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
    return jsonResp({ ok: true, engine: res.model, data: parsed });
  } catch (err) {
    return jsonResp({
      ok: false,
      code: 'OCR_PARSE_ERROR',
      error: err instanceof Error ? err.message : String(err),
    }, 502);
  }
});
