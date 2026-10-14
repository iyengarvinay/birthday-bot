# Birthday Bot

Text it your friends' birthdays over iMessage; it texts you on the day.

```
You:  Varun 5/6
Bot:  Saved! I'll text you on: Varun (May 6).

…every May 6 at 9am Eastern…

Bot:  It's Varun's bday today 🎂
```

## What you can text it

| Text | What happens |
|---|---|
| `Varun 5/6` | Saves Varun's birthday (US month/day) |
| `Varun May 6`, `5/6 Varun`, `Varun 5/6/1990` | Also work; the year is ignored |
| Several lines, or `Varun 5/6, Priya 7/12` | Saves them all |
| `Varun 5/7` (same name again) | Updates the date |
| `list` | Shows everything you've saved |
| `delete Varun` | Removes it |
| `help` | Shows these instructions |

Each phone number has its own list. Two birthdays on the same day arrive as
one text ("Birthdays today: Varun and Priya 🎂"). Feb 29 birthdays get their
reminder on Feb 28 in non-leap years.

## How it works

- **Sendblue** gives the bot an iMessage number. When someone texts it,
  Sendblue posts the message to this app's `/webhook` URL, and the app replies
  through Sendblue's API.
- **Cloudflare Workers** runs the app (free tier), with birthdays stored in a
  **D1** database.
- A scheduled job runs each morning and sends reminders at `SEND_HOUR` in
  `TIME_ZONE` (9am `America/New_York` by default; change them in
  `wrangler.toml`). Each reminder is recorded when sent, so none go out twice,
  and a later run that morning retries any that failed.

**Sendblue free plan:** a person's texts only reach the bot after they're added
as a contact in your Sendblue dashboard, so add yourself (and anyone else who
will use it) there first. Letting anyone text it requires a paid Sendblue plan.

## Setup

You need a Sendblue account and a Cloudflare account (both free to start).

1. **Install:** `npm install`
2. **Log in to Cloudflare:** `npx wrangler login`
3. **Create the database:** `npx wrangler d1 create birthday-bot`, then paste
   the printed `database_id` into `wrangler.toml`.
4. **Create the table:** `npm run db:migrate`
5. **Add secrets** (each command prompts for the value):
   ```
   npx wrangler secret put SENDBLUE_API_KEY_ID
   npx wrangler secret put SENDBLUE_API_SECRET_KEY
   npx wrangler secret put SENDBLUE_FROM_NUMBER   # e.g. +12125551234
   npx wrangler secret put WEBHOOK_SECRET         # any long random string
   ```
   The API keys and number are in your Sendblue dashboard. For
   `WEBHOOK_SECRET`, make one up, e.g. with `openssl rand -hex 24`.
6. **Deploy:** `npm run deploy`. Wrangler prints the app's URL, e.g.
   `https://birthday-bot.<you>.workers.dev`.
7. **Connect Sendblue:** in the Sendblue dashboard, set the webhook for
   **received messages** to
   `https://birthday-bot.<you>.workers.dev/webhook?secret=<your WEBHOOK_SECRET>`.
   If Sendblue lets you set a signing secret instead, use the same value there.
8. **Add yourself as a contact** in Sendblue (free plan), then text the bot
   `help`.

## Development

```
npm test           # unit tests (the real SQL runs against in-memory SQLite)
npm run typecheck
npm run db:migrate:local && npm run dev
```

`npm run dev` serves the app locally; to trigger the morning job by hand, open
`http://localhost:8787/__scheduled?cron=0+13+*+*+*`.

## Troubleshooting

- **No reply:** check `npx wrangler tail` while texting the bot. A 401 means
  the webhook URL's `secret` doesn't match `WEBHOOK_SECRET`.
- **Sendblue API errors:** Sendblue's docs show both `https://api.sendblue.co`
  and `https://api.sendblue.com`; if sends fail, switch `SENDBLUE_API_BASE` in
  `wrangler.toml` and redeploy.
