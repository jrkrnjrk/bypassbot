# FastForward Discord bot

All bypass logic is **on the bot**. It does not call bypass.vip, FastForward crowd, or any other third-party bypass API.

It only talks to:

- Discord
- The URL you paste (same as opening that page)

## Commands (both work)

Slash (registered from the bot token on startup):

```
/bypass url:https://linkvertise.com/...
/supported
/supported query:work.ink
```

Prefix (works even if slash has not appeared yet):

```
!bypass https://linkvertise.com/...
!supported
!supported linkvertise
```

## Discord setup (this is why “nothing is called”)

1. https://discord.com/developers/applications → New Application
2. Bot → Reset Token → that value is `DISCORD_TOKEN`
3. Bot → Privileged Gateway Intents → enable **Message Content Intent**
4. Invite (replace APPLICATION_ID):

```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=18432
```

If `/bypass` does not show, type `!bypass <url>` in the server. Slash commands can take a few minutes globally. Set `GUILD_ID` to your server ID so they appear immediately.

## Railway variables

```
DISCORD_TOKEN=...
GUILD_ID=optional_server_id
PREFIX=!
```

No `CLIENT_ID` needed. Commands are registered from the token after login.

## Local

```bash
cp .env.example .env
npm install
npm start
```

Node 20+.

## Honest limit

FastForward’s original code runs inside a browser tab. This bot embeds those modules as server-side JS. Sites that need a captcha click or a live DOM still will not resolve. Nothing external is called to paper over that.
