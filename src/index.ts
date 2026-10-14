import { dueReminders, handleText } from "./bot";
import { isAuthorizedWebhook, sendMessage, type InboundMessage, type SendblueEnv } from "./sendblue";
import { D1Store } from "./store";

export interface Env extends SendblueEnv {
  DB: D1Database;
  TIME_ZONE: string;
  SEND_HOUR: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("birthday-bot is running");
    }
    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }
    if (!isAuthorizedWebhook(request, env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const msg = (await request.json()) as InboundMessage;
    const phone = msg.from_number ?? msg.number;
    // Sendblue also posts status updates for messages we send; only answer
    // texts people send us, and stay out of group chats.
    if (msg.is_outbound || msg.group_id || !phone || typeof msg.content !== "string") {
      return new Response("ignored");
    }

    const reply = await handleText(new D1Store(env.DB), phone, msg.content);
    await sendMessage(env, phone, reply);
    return new Response("ok");
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const store = new D1Store(env.DB);
    const { year, messages } = await dueReminders(
      store,
      new Date(controller.scheduledTime),
      env.TIME_ZONE,
      Number(env.SEND_HOUR),
    );

    const failures: unknown[] = [];
    for (const m of messages) {
      try {
        await sendMessage(env, m.phone, m.text);
        for (const b of m.birthdays) await store.markSent(b, year);
      } catch (err) {
        // Left unmarked, so the next run today sends them again.
        failures.push(err);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} of ${messages.length} reminders failed`);
    }
  },
} satisfies ExportedHandler<Env>;
