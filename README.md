# FastForward Discord bot (Railway)

Port of [FastForwardTeam/FastForward](https://github.com/FastForwardTeam/FastForward) for Discord.

FastForward is a **browser extension**. It clicks around a live page (`document.querySelector`, form submit, XHR hooks). You cannot drop that repo onto Railway and have `/bypass` work. This bot:

- Registers `/bypass` and `/supported`
- Uses FastForward’s official host list
- Reimplements the FastForward modules that work without a browser
  - `linkvertise.js` GraphQL + `?r=` base64
  - `boost.js` HTML token
  - `rekonise.js` public API
  - `sub2unlock.js` / `ytsubme.js` / `letsboost.js` HTML
  - `workink.js` websocket
- Falls back to HTTP redirects, meta-refresh, and FastForward crowd:
  `https://crowd.fastforward.team/crowd/query_v1`

DOM-only / captcha / “watch this video” hosts will still fail. That is FastForward’s design, not a missing token.

## Commands

```
/bypass url:<link>
/supported
/supported query:linkvertise
```

## Railway

1. Push this folder to a GitHub repo (or deploy from the zip).
2. New project on [Railway](https://railway.app) → Deploy from GitHub.
3. Variables:

```
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=optional_test_server_id
```

`PORT` is set by Railway. The process binds an HTTP health check on that port so Railway does not kill the bot.

4. Discord invite (replace CLIENT_ID):

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=18432
```

5. Create the Discord app at https://discord.com/developers/applications  
   Bot page → token. General Information → Application ID.

If slash commands do not show, set `GUILD_ID` to your server ID and redeploy. Global commands can take up to an hour.

## Local

```bash
cp .env.example .env
npm install
npm start
```

Needs Node 20+.

## What this is not

- Not the FastForward Chrome/Firefox extension
- Not a full Playwright replay of every `src/bypasses/*.js` file
- FastForward itself is no longer actively maintained; some modules are already stale

Credits: FastForward team. Unlicense on the upstream project.
