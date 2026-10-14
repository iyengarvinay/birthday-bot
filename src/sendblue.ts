export interface SendblueEnv {
  SENDBLUE_API_KEY_ID: string;
  SENDBLUE_API_SECRET_KEY: string;
  /** The bot's Sendblue number in E.164 form, e.g. +12125551234. */
  SENDBLUE_FROM_NUMBER: string;
  /** API host. Sendblue's docs use both api.sendblue.co and api.sendblue.com. */
  SENDBLUE_API_BASE: string;
  /** Shared secret that proves a webhook call came from Sendblue. */
  WEBHOOK_SECRET: string;
}

/** The fields this bot reads from Sendblue's "receive message" webhook. */
export interface InboundMessage {
  content?: string;
  from_number?: string;
  number?: string;
  is_outbound?: boolean;
  group_id?: string;
}

/**
 * Sendblue calls the webhook URL you register in its dashboard. We accept the
 * call if it carries WEBHOOK_SECRET either as Sendblue's signing-secret header
 * or as a `secret` query parameter on the registered URL, so it works however
 * the dashboard is set up.
 */
export function isAuthorizedWebhook(request: Request, secret: string): boolean {
  if (!secret) return false;
  const header = request.headers.get("sb-signing-secret");
  const query = new URL(request.url).searchParams.get("secret");
  return (header !== null && timingSafeEqual(header, secret))
    || (query !== null && timingSafeEqual(query, secret));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sendMessage(env: SendblueEnv, to: string, content: string): Promise<void> {
  const res = await fetch(`${env.SENDBLUE_API_BASE}/api/send-message`, {
    method: "POST",
    headers: {
      "sb-api-key-id": env.SENDBLUE_API_KEY_ID,
      "sb-api-secret-key": env.SENDBLUE_API_SECRET_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ number: to, content, from_number: env.SENDBLUE_FROM_NUMBER }),
  });
  if (!res.ok) {
    throw new Error(`Sendblue send to ${to} failed: ${res.status} ${await res.text()}`);
  }
}
