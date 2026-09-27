import http from "node:http";
import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  SlashCommandBuilder,
} from "discord.js";
import { bypass } from "./engine.js";
import { FF_MODULES, filterSupported, isSupportedHost } from "./supported.js";

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = Number(process.env.PORT || 3000);
const PREFIX = process.env.PREFIX || "!";

if (!TOKEN) {
  console.error("DISCORD_TOKEN is required");
  process.exit(1);
}

const PAGE_SIZE = 40;
const cooldown = new Map();
const COOLDOWN_MS = 2500;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName("bypass")
    .setDescription("Resolve a shortener / ad-link using FastForward bypass modules")
    .addStringOption((o) =>
      o.setName("url").setDescription("The link to bypass").setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("supported")
    .setDescription("Show hosts FastForward knows about")
    .addStringOption((o) =>
      o.setName("query").setDescription("Optional filter, e.g. linkvertise").setRequired(false)
    )
    .toJSON(),
];

async function registerCommands() {
  // Token is enough. Commands live on this bot application.
  if (GUILD_ID) {
    await client.application.commands.set(commands, GUILD_ID);
    console.log(`Registered guild commands for ${GUILD_ID}`);
  } else {
    await client.application.commands.set(commands);
    console.log("Registered global slash commands");
  }
}

function extractUrl(input) {
  const m = String(input || "").match(/https?:\/\/[^\s<>"]+/i);
  return m ? m[0] : null;
}

function supportedEmbed(query, page) {
  const list = filterSupported(query);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const slice = list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const modules = FF_MODULES.map((m) => `\`${m.file}\` → ${m.hosts.join(", ")}`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("FastForward supported hosts")
    .setDescription(
      slice.length
        ? slice.map((d) => `• \`${d}\``).join("\n")
        : "No hosts matched that filter."
    )
    .addFields({
      name: "Server-side modules ported",
      value: modules.slice(0, 1024),
    })
    .setFooter({
      text: `${list.length} host(s) · page ${safePage + 1}/${pages} · FastForwardTeam/FastForward`,
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sup:${safePage - 1}:${query || ""}`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`sup:${safePage + 1}:${query || ""}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= pages - 1)
  );

  return { embeds: [embed], components: [row] };
}

http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("fastforward-discord-bot ok");
  })
  .listen(PORT, () => console.log(`Health server on :${PORT}`));

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("Command registration failed:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("sup:")) {
    const [, pageStr, ...rest] = interaction.customId.split(":");
    const query = rest.join(":");
    await interaction.update(supportedEmbed(query, Number(pageStr) || 0));
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "supported") {
    const query = interaction.options.getString("query") || "";
    await interaction.reply(supportedEmbed(query, 0));
    return;
  }

  if (interaction.commandName !== "bypass") return;

  const raw = interaction.options.getString("url", true);
  const target = extractUrl(raw);
  if (!target) {
    await interaction.reply({ content: "Give me a valid `http://` or `https://` URL.", ephemeral: true });
    return;
  }

  const now = Date.now();
  const last = cooldown.get(interaction.user.id) || 0;
  if (now - last < COOLDOWN_MS) {
    await interaction.reply({ content: "Wait a couple of seconds between bypasses.", ephemeral: true });
    return;
  }
  cooldown.set(interaction.user.id, now);

  await interaction.deferReply();

  try {
    const result = await bypass(target);
    const known = isSupportedHost(target);
    const embed = new EmbedBuilder()
      .setColor(result.changed ? 0x57f287 : 0xfee75c)
      .setTitle(result.changed ? "Bypass result" : "No destination found")
      .addFields(
        { name: "Original", value: result.original.slice(0, 1024) },
        { name: "Destination", value: result.destination.slice(0, 1024) },
        {
          name: "FastForward",
          value: [
            known ? "Host is on the FastForward list" : "Host is not on the official list",
            result.module ? `Module: \`${result.module}\`` : "Module: local redirect / page source",
          ].join("\n"),
        }
      )
      .setFooter({ text: "Port of FastForwardTeam/FastForward · not the browser extension" });

    if (result.steps.length) {
      embed.addFields({
        name: "Hops",
        value: result.steps
          .map((s, i) => `${i + 1}. ${s.via}`)
          .join("\n")
          .slice(0, 1024),
      });
    }

    if (!result.changed) {
      embed.setDescription(
        "FastForward was written to run **inside a browser tab**. This bot ports the modules that work over HTTP/WS. Captcha / social-unlock / DOM-only sites often still need the real extension."
      );
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("Bypass failed")
          .setDescription(String(err.message || err).slice(0, 4000)),
      ],
    });
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const [cmd, ...rest] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const arg = rest.join(" ");

  if (cmd === "supported") {
    await message.reply(supportedEmbed(arg, 0));
    return;
  }

  if (cmd !== "bypass") return;

  const target = extractUrl(arg) || extractUrl(message.content);
  if (!target) {
    await message.reply(`Usage: \`${PREFIX}bypass https://linkvertise.com/...\``);
    return;
  }

  const now = Date.now();
  const last = cooldown.get(message.author.id) || 0;
  if (now - last < COOLDOWN_MS) {
    await message.reply("Wait a couple of seconds between bypasses.");
    return;
  }
  cooldown.set(message.author.id, now);

  const pending = await message.reply("Bypassing…");
  try {
    const result = await bypass(target);
    const known = isSupportedHost(target);
    const embed = new EmbedBuilder()
      .setColor(result.changed ? 0x57f287 : 0xfee75c)
      .setTitle(result.changed ? "Bypass result" : "No destination found")
      .addFields(
        { name: "Original", value: result.original.slice(0, 1024) },
        { name: "Destination", value: result.destination.slice(0, 1024) },
        {
          name: "FastForward",
          value: [
            known ? "Host is on the FastForward list" : "Host is not on the official list",
            result.module ? `Module: \`${result.module}\`` : "Module: local redirect / page source",
          ].join("\n"),
        }
      )
      .setFooter({ text: "All logic runs on this bot · FastForwardTeam/FastForward modules" });

    if (result.steps.length) {
      embed.addFields({
        name: "Hops",
        value: result.steps
          .map((s, i) => `${i + 1}. ${s.via}`)
          .join("\n")
          .slice(0, 1024),
      });
    }

    await pending.edit({ content: null, embeds: [embed] });
  } catch (err) {
    await pending.edit({
      content: null,
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("Bypass failed")
          .setDescription(String(err.message || err).slice(0, 4000)),
      ],
    });
  }
});

client.login(TOKEN);
