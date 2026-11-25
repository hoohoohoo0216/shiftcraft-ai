// ShiftCraft AI — LINE Messaging API Push Notification Edge Function
// Deploy in Supabase Dashboard → Edge Functions → Create function named "line-notify"
// Required Secret: LINE_CHANNEL_ACCESS_TOKEN (from LINE Developers → Messaging API → Channel access token)

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }

  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || '';
  if (!token) {
    return jsonResp({
      ok: false,
      code: 'MISSING_TOKEN',
      error: '尚未在 Supabase Edge Function Secrets 設定 LINE_CHANNEL_ACCESS_TOKEN',
    }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const rawTo = Array.isArray(body.to) ? body.to : (body.to ? [body.to] : []);
  const recipients = Array.from(new Set(
    rawTo
      .map((u) => String(u || '').trim())
      .filter((u) => /^U[0-9a-f]{16,64}$/i.test(u))
  ));
  if (recipients.length === 0) {
    return jsonResp({ ok: false, code: 'NO_RECIPIENTS', error: '沒有有效的 LINE userId 收件人' }, 400);
  }

  const headerTitle = String(body.headerTitle || '班匠 ShiftCraft 通知').slice(0, 60);
  const headerColor = /^#[0-9a-fA-F]{6}$/.test(String(body.headerColor || ''))
    ? String(body.headerColor)
    : '#0F766E';
  const storeName = String(body.storeName || '').slice(0, 60);
  const headline = String(body.headline || headerTitle).slice(0, 120);
  const detailLines = (Array.isArray(body.lines) ? body.lines : [])
    .map((l) => String(l || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const buttonLabel = String(body.buttonLabel || '開啟班匠 LINE').slice(0, 20);
  const buttonUrl = /^https:\/\/.+/i.test(String(body.buttonUrl || ''))
    ? String(body.buttonUrl)
    : '';
  const altText = String(body.altText || `${headerTitle}：${headline}`).slice(0, 390);

  const bodyContents: Record<string, unknown>[] = [
    {
      type: 'text',
      text: headline,
      weight: 'bold',
      size: 'md',
      color: '#0F172A',
      wrap: true,
    },
  ];

  if (detailLines.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'md', color: '#E2E8F0' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      spacing: 'xs',
      contents: detailLines.map((line) => ({
        type: 'text',
        text: line,
        size: 'sm',
        color: '#475569',
        wrap: true,
      })),
    });
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: headerColor,
      paddingAll: '14px',
      contents: [
        {
          type: 'text',
          text: headerTitle,
          color: '#FFFFFF',
          weight: 'bold',
          size: 'sm',
          wrap: true,
        },
        ...(storeName
          ? [{
              type: 'text',
              text: storeName,
              color: '#E2E8F0',
              size: 'xs',
              margin: 'xs',
              wrap: true,
            }]
          : []),
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '14px',
      contents: bodyContents,
    },
  };

  if (buttonUrl) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: headerColor,
          height: 'sm',
          action: {
            type: 'uri',
            label: buttonLabel,
            uri: buttonUrl,
          },
        },
      ],
    };
  }

  const message = {
    type: 'flex',
    altText,
    contents: bubble,
  };

  const isMulti = recipients.length > 1;
  const lineEndpoint = isMulti
    ? 'https://api.line.me/v2/bot/message/multicast'
    : 'https://api.line.me/v2/bot/message/push';
  const linePayload = isMulti
    ? { to: recipients.slice(0, 500), messages: [message] }
    : { to: recipients[0], messages: [message] };

  try {
    const lineRes = await fetch(lineEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(linePayload),
    });
    const resText = await lineRes.text();
    if (!lineRes.ok) {
      return jsonResp({
        ok: false,
        code: 'LINE_API_ERROR',
        status: lineRes.status,
        error: resText || `LINE API HTTP ${lineRes.status}`,
      }, 502);
    }
    return jsonResp({ ok: true, sent: recipients.length });
  } catch (err) {
    return jsonResp({
      ok: false,
      code: 'NETWORK_ERROR',
      error: err instanceof Error ? err.message : String(err),
    }, 502);
  }
});
