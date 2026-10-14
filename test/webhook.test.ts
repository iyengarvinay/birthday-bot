import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { isAuthorizedWebhook } from "../src/sendblue";
import { sqliteD1 } from "./sqlite-d1";

const SECRET = "s3cret-value";

function env(): Env {
  return {
    DB: sqliteD1(),
    TIME_ZONE: "America/New_York",
    SEND_HOUR: "9",
    SENDBLUE_API_KEY_ID: "key-id",
    SENDBLUE_API_SECRET_KEY: "secret-key",
    SENDBLUE_FROM_NUMBER: "+15555550000",
    SENDBLUE_API_BASE: "https://api.sendblue.test",
    WEBHOOK_SECRET: SECRET,
  };
}

const inbound = (body: object, query = `?secret=${SECRET}`) =>
  new Request(`https://bot.example.workers.dev/webhook${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

afterEach(() => vi.unstubAllGlobals());

function captureSends() {
  const sent: Array<{ url: string; headers: Record<string, string>; body: Record<string, string> }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return new Response("{}", { status: 200 });
  });
  return sent;
}

describe("isAuthorizedWebhook", () => {
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
  it("accepts the secret as Sendblue's header or as a query parameter", () => {
    expect(isAuthorizedWebhook(req("https://x/webhook", { "sb-signing-secret": SECRET }), SECRET)).toBe(true);
    expect(isAuthorizedWebhook(req(`https://x/webhook?secret=${SECRET}`), SECRET)).toBe(true);
  });
  it("rejects a missing or wrong secret, and refuses everything if none is configured", () => {
    expect(isAuthorizedWebhook(req("https://x/webhook"), SECRET)).toBe(false);
    expect(isAuthorizedWebhook(req("https://x/webhook?secret=nope"), SECRET)).toBe(false);
    expect(isAuthorizedWebhook(req("https://x/webhook?secret="), "")).toBe(false);
  });
});

describe("webhook", () => {
  it("replies to the sender through Sendblue", async () => {
    const sent = captureSends();
    const res = await worker.fetch(inbound({ content: "Varun 5/6", from_number: "+15555550100", is_outbound: false }), env());
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.sendblue.test/api/send-message");
    expect(sent[0]!.headers).toMatchObject({ "sb-api-key-id": "key-id", "sb-api-secret-key": "secret-key" });
    expect(sent[0]!.body).toEqual({
      number: "+15555550100",
      content: "Saved! I'll text you on: Varun (May 6).",
      from_number: "+15555550000",
    });
  });

  it("rejects calls without the secret", async () => {
    const sent = captureSends();
    const res = await worker.fetch(inbound({ content: "list", from_number: "+15555550100" }, ""), env());
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("ignores status callbacks for its own messages and group chats", async () => {
    const sent = captureSends();
    await worker.fetch(inbound({ content: "hi", from_number: "+15555550100", is_outbound: true }), env());
    await worker.fetch(inbound({ content: "hi", from_number: "+15555550100", group_id: "g1" }), env());
    expect(sent).toHaveLength(0);
  });
});

describe("scheduled", () => {
  it("texts reminders at 9am and records them so a later run doesn't repeat them", async () => {
    const e = env();
    captureSends();
    await worker.fetch(inbound({ content: "Varun 5/6", from_number: "+15555550100" }), e);

    const sent = captureSends();
    const run = (iso: string) =>
      worker.scheduled({ scheduledTime: Date.parse(iso), cron: "", noRetry() {} } as ScheduledController, e);

    await run("2027-05-06T13:00:00Z");
    await run("2027-05-06T14:00:00Z");
    expect(sent.map((s) => s.body.content)).toEqual(["It's Varun's bday today 🎂"]);
  });

  it("leaves a failed reminder unsent so the next run retries it", async () => {
    const e = env();
    captureSends();
    await worker.fetch(inbound({ content: "Varun 5/6", from_number: "+15555550100" }), e);

    vi.stubGlobal("fetch", async () => new Response("down", { status: 500 }));
    const run = (iso: string) =>
      worker.scheduled({ scheduledTime: Date.parse(iso), cron: "", noRetry() {} } as ScheduledController, e);
    await expect(run("2027-05-06T13:00:00Z")).rejects.toThrow(/1 of 1 reminders failed/);

    const sent = captureSends();
    await run("2027-05-06T14:00:00Z");
    expect(sent).toHaveLength(1);
  });
});
