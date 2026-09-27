/**
 * Server-side port of FastForward bypass modules.
 * Source: https://github.com/FastForwardTeam/FastForward
 *
 * FastForward is a browser extension. This engine reimplements the
 * modules that can run without a real page (fetch / GraphQL / WS / HTML parse)
 * No third-party bypass APIs. The bot only talks to Discord and
 * to the shortener URL you pasted (same as FastForward in a browser).
 */

import WebSocket from "ws";
import { hostnameOf, isSupportedHost } from "./supported.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MAX_HOPS = 8;

function sameDest(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.href.replace(/\/$/, "") === ub.href.replace(/\/$/, "");
  } catch {
    return a === b;
  }
}

function extractUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s"'<>\\]+/i);
  return m ? m[0].replace(/[),.;]+$/, "") : null;
}

function decodeRParam(url) {
  try {
    const u = new URL(url);
    const r = u.searchParams.get("r");
    if (!r) return null;
    const decoded = Buffer.from(decodeURIComponent(r), "base64").toString("utf8");
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchText(url, method = "GET") {
  const res = await fetch(url, {
    method,
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
  });
  const location = res.headers.get("location");
  const text = await res.text().catch(() => "");
  return { status: res.status, location, text, finalUrl: res.url || url };
}

async function followHttp(url) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const { status, location } = await fetchText(current);
    if (status >= 300 && status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    break;
  }
  return current;
}

function metaRefresh(html, base) {
  const m = html.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)/i)
    || html.match(/content=["'][^"']*url=([^"']+)["'][^>]*http-equiv=["']refresh["']/i);
  if (!m) return null;
  try {
    return new URL(m[1].replace(/['"]/g, "").trim(), base).href;
  } catch {
    return null;
  }
}

function scanHtmlForDestination(html, base) {
  const patterns = [
    /stepDat = '(.+?)';/,
    /bufpsvdhmjybvgfncqfa="([^"]+)"/,
    /id=["']link["'][^>]*href=["']([^"']+)/i,
    /href=["']([^"']+)["'][^>]*id=["']link["']/i,
    /<a[^>]+id=["']skip["'][^>]*href=["']([^"']+)/i,
    /window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/i,
    /"destination"\s*:\s*"(https?:\/\/[^"]+)"/i,
    /"targetUrl"\s*:\s*"(https?:\/\/[^"]+)"/i,
    /"target_url"\s*:\s*"(https?:\/\/[^"]+)"/i,
    /"finalUrl"\s*:\s*"(https?:\/\/[^"]+)"/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    let value = m[1];
    if (re.source.startsWith("stepDat")) {
      try {
        const jsonDat = JSON.parse(value);
        value = jsonDat[jsonDat.length - 1]?.url;
      } catch {
        continue;
      }
    }
    if (re.source.includes("bufpsvdhmjybvgfncqfa")) {
      try {
        value = Buffer.from(value, "base64").toString("utf8");
      } catch {
        continue;
      }
    }
    if (value && /^https?:\/\//i.test(value)) {
      try {
        return new URL(value, base).href;
      } catch {
        return value;
      }
    }
  }
  return metaRefresh(html, base);
}

// FastForward src/bypasses/linkvertise.js
async function bypassLinkvertise(url) {
  const fromR = decodeRParam(url);
  if (fromR) return fromR;

  const u = new URL(url);
  const path = u.pathname.replace(/\/[0-9]$/, "");
  const regexMatch = path.match(/^\/(\d+)\/([\w-]+)$/);
  if (!regexMatch) return null;
  const userId = regexMatch[1];
  const slug = regexMatch[2];

  const page = await fetchText(url);
  const ut =
    (page.text.match(/X-LINKVERTISE-UT["'\s:=]+([A-Za-z0-9._-]+)/i) || [])[1] ||
    "";

  const gql = async (payload) => {
    const endpoint = `https://publisher.linkvertise.com/graphql${ut ? `?X-Linkvertise-UT=${ut}` : ""}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": UA,
        Origin: "https://linkvertise.com",
        Referer: url,
      },
      body: JSON.stringify(payload),
    });
    return res.json().catch(() => null);
  };

  const detail = await gql({
    operationName: "getDetailPageContent",
    variables: {
      linkIdentificationInput: { userIdAndUrl: { user_id: Number(userId) || userId, url: slug } },
    },
    query:
      "query getDetailPageContent($linkIdentificationInput: PublicLinkIdentificationInput!) { getDetailPageContent(linkIdentificationInput: $linkIdentificationInput) { access_token } }",
  });

  const accessToken = detail?.data?.getDetailPageContent?.access_token;
  if (!accessToken) return null;

  const complete = await gql({
    operationName: "completeDetailPageContent",
    variables: {
      linkIdentificationInput: { userIdAndUrl: { user_id: Number(userId) || userId, url: slug } },
      completeDetailPageContentInput: { access_token: accessToken },
    },
    query:
      "mutation completeDetailPageContent($linkIdentificationInput: PublicLinkIdentificationInput!, $completeDetailPageContentInput: CompleteDetailPageContentInput!) { completeDetailPageContent(linkIdentificationInput: $linkIdentificationInput, completeDetailPageContentInput: $completeDetailPageContentInput) { TARGET } }",
  });

  const TARGET = complete?.data?.completeDetailPageContent?.TARGET;
  if (!TARGET) return null;

  const targetPage = await gql({
    query:
      "mutation getDetailPageTarget($linkIdentificationInput: PublicLinkIdentificationInput!, $token: String!) { getDetailPageTarget(linkIdentificationInput: $linkIdentificationInput, token: $token) { type url paste } }",
    variables: {
      linkIdentificationInput: { userIdAndUrl: { user_id: Number(userId) || userId, url: slug } },
      token: TARGET,
    },
  });

  return targetPage?.data?.getDetailPageTarget?.url || null;
}

// FastForward src/bypasses/boost.js
async function bypassBoost(url) {
  const { text } = await fetchText(url);
  const part = text.split('bufpsvdhmjybvgfncqfa="')[1];
  if (!part) return null;
  const b64 = part.split('"')[0];
  try {
    const dest = Buffer.from(b64, "base64").toString("utf8");
    if (/^https?:\/\//i.test(dest)) return dest;
  } catch {
    /* ignore */
  }
  return null;
}

// FastForward src/bypasses/rekonise.js
async function bypassRekonise(url) {
  const path = new URL(url).pathname;
  const res = await fetch(`https://api.rekonise.com/social-unlocks${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const data = await res.json().catch(() => null);
  return data?.url || null;
}

// FastForward src/bypasses/sub2unlock.js
async function bypassSub2unlock(url) {
  if (url.includes("sub2unlock.com/link/unlock")) {
    const { text } = await fetchText(url);
    const href = text.match(/id=["']link["'][^>]*href=["']([^"']+)/i);
    return href ? href[1] : null;
  }
  const slug = url.split("/").filter(Boolean).pop();
  return `https://sub2unlock.com/link/unlock/${slug}`;
}

// FastForward src/bypasses/ytsubme.js
async function bypassYtsubme(url) {
  const { text } = await fetchText(url);
  const href = text.match(/<a[^>]+id=["']link["'][^>]*href=["']([^"']+)/i)
    || text.match(/href=["']([^"']+)["'][^>]*id=["']link["']/i);
  return href ? href[1] : null;
}

// FastForward src/bypasses/letsboost.js
async function bypassLetsboost(url) {
  const { text } = await fetchText(url);
  const m = text.match(/stepDat = '(.*)';/);
  if (!m) return null;
  try {
    const jsonDat = JSON.parse(m[1]);
    return jsonDat[jsonDat.length - 1]?.url || null;
  } catch {
    return null;
  }
}

// FastForward src/bypasses/workink.js (websocket path)
async function bypassWorkink(url) {
  const pathname = new URL(url).pathname.slice(1);
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [encodedUserId, linkCustom] = parts.slice(-2);

  const BASE = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let decodedUserId = BASE.indexOf(encodedUserId[0]);
  if (decodedUserId < 0) return null;
  for (let i = 1; i < encodedUserId.length; i++) {
    decodedUserId = 62 * decodedUserId + BASE.indexOf(encodedUserId[i]);
  }

  return new Promise((resolve) => {
    const ws = new WebSocket("wss://redirect-api.work.ink/v1/ws");
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(null);
    }, 20000);

    const send = (obj) => ws.send(JSON.stringify(obj));

    ws.on("open", () => {
      send({
        type: "c_announce",
        payload: { linkCustom, linkUserId: decodedUserId, referer: "unknown" },
      });
    });

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (data.error) return;
      switch (data.type) {
        case "s_start_recaptcha_check":
          send({
            type: "c_recaptcha_response",
            payload: { recaptchaResponse: crypto.randomUUID() },
          });
          break;
        case "s_link_destination": {
          let dest = data.payload?.url;
          try {
            const parsed = new URL(dest);
            if (parsed.searchParams.has("duf")) {
              dest = Buffer.from(
                parsed.searchParams.get("duf").split("").reverse().join(""),
                "base64"
              ).toString("utf8");
            }
          } catch {
            /* keep dest */
          }
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          resolve(dest || null);
          break;
        }
        default:
          break;
      }
    });

    ws.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function hostHandler(url) {
  const host = hostnameOf(url);

  if (host.endsWith("linkvertise.com") || host.endsWith("linkvertise.net") || host.endsWith("link-to.net")) {
    return { dest: await bypassLinkvertise(url), module: "linkvertise.js" };
  }
  if (host === "boost.ink") return { dest: await bypassBoost(url), module: "boost.js" };
  if (host === "rekonise.com") return { dest: await bypassRekonise(url), module: "rekonise.js" };
  if (host === "sub2unlock.com") return { dest: await bypassSub2unlock(url), module: "sub2unlock.js" };
  if (host === "ytsubme.com") return { dest: await bypassYtsubme(url), module: "ytsubme.js" };
  if (host === "letsboost.net") return { dest: await bypassLetsboost(url), module: "letsboost.js" };
  if (host === "work.ink" || host.endsWith(".work.ink")) {
    return { dest: await bypassWorkink(url), module: "workink.js" };
  }
  return { dest: null, module: null };
}

export async function bypass(inputUrl) {
  const steps = [];
  let current = inputUrl;
  let moduleUsed = null;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const redirected = await followHttp(current);
    if (!sameDest(redirected, current)) {
      steps.push({ from: current, to: redirected, via: "http-redirect" });
      current = redirected;
    }

    const fromR = decodeRParam(current);
    if (fromR && !sameDest(fromR, current)) {
      steps.push({ from: current, to: fromR, via: "linkvertise-r-param" });
      current = fromR;
      moduleUsed = moduleUsed || "linkvertise.js";
      continue;
    }

    const handled = await hostHandler(current);
    if (handled.dest && !sameDest(handled.dest, current)) {
      steps.push({ from: current, to: handled.dest, via: handled.module });
      moduleUsed = handled.module;
      current = handled.dest;
      continue;
    }

    const { text } = await fetchText(current);
    const scraped = scanHtmlForDestination(text, current);
    if (scraped && !sameDest(scraped, current)) {
      steps.push({ from: current, to: scraped, via: "page-source" });
      current = scraped;
      continue;
    }

    break;
  }

  return {
    original: inputUrl,
    destination: current,
    changed: !sameDest(current, inputUrl),
    supported: isSupportedHost(inputUrl) || isSupportedHost(current),
    module: moduleUsed,
    steps,
  };
}
