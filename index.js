/**
 * index.js - Nexus Key Bot (production-ready)
 *
 * Requirements:
 * - Put sensitive values into a .env file:
 *   NEXUS_TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID, LOG_CHANNEL_ID, PREMIUM_ROLE_ID,
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PUBLIC_URL, PORT,
 *   JUNKIE_API_URL, JUNKIE_API_KEY,
 *   BYPASS_CHANNEL_ID, BYPASS_API_URL, BYPASS_API_KEY
 *
 * Notes:
 * - This file uses dynamic import for node-fetch to keep compatibility with
 *   Node ESM/common usage. No secret strings are stored here.
 * - Webhook URLs for services are included in WEBHOOKS constant.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const crypto = require("crypto");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const express = require("express");
const bodyParser = require("body-parser");

// =============================
// ⚙️ ENVIRONMENT CONFIG
// =============================
const TOKEN = process.env.NEXUS_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const PREMIUM_ROLE_ID = process.env.PREMIUM_ROLE_ID;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://example.com
const PORT = process.env.PORT || 24589;

// Optional Junkie analytics
const JUNKIE_API_URL = process.env.JUNKIE_API_URL;
const JUNKIE_API_KEY = process.env.JUNKIE_API_KEY;

// BYPASS settings
const BYPASS_CHANNEL_ID = process.env.BYPASS_CHANNEL_ID;
const BYPASS_API_URL = process.env.BYPASS_API_URL || "https://api.bypass.vip/premium/bypass";
const BYPASS_API_KEY = process.env.BYPASS_API_KEY;
const BYPASS_GIF_PATH = path.resolve("./nexus-nexushvh.gif");

// =============================
// 🪙 PAYPAL CONFIG (LIVE)
// =============================
const app = express();
app.use(bodyParser.json());
// Toggle between LIVE and SANDBOX
const PAYPAL_MODE = process.env.PAYPAL_MODE || "live"; // "live" or "sandbox"
const PAYPAL_API = PAYPAL_MODE === "sandbox" 
  ? "https://api-m.sandbox.paypal.com" 
  : "https://api-m.paypal.com";

async function generateAccessToken() {
  // Uses client credentials to get an access token
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal credentials not configured");
  }
  
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  
  if (!res.ok) {
    const text = await res.text();
    console.error(`PayPal Token Error: Status ${res.status}, Response: ${text}`);
    throw new Error(`PayPal authentication failed. Check your CLIENT_ID and SECRET in .env file.`);
  }
  
  const data = await res.json();
  return data.access_token;
}

// =============================
// 🤖 DISCORD CLIENT
// =============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// persistent store for panel role permissions
const PANEL_FILE = path.resolve("./panels.json");
let panelPermissions = fs.existsSync(PANEL_FILE)
  ? JSON.parse(fs.readFileSync(PANEL_FILE, "utf8"))
  : {};
function savePanels() {
  fs.writeFileSync(PANEL_FILE, JSON.stringify(panelPermissions, null, 2));
}

// simple keystore for resendkey
const keyStore = new Map();
const cooldowns = new Set();

const HMAC_SECRET = process.env.HMAC_SECRET || "NEXUS-SECRET-KEY-1298";
const HMAC_HEADER = "X-Nexus-Signature";

// =============================
// 🔗 WEBHOOKS LIST (services)
// =============================
const WEBHOOKS = {
  Rivals: "https://api.junkie-development.de/api/v1/webhooks/execute/84302048-8e70-4a6a-9a76-7ee02717643d",
  Arsenal: "https://api.junkie-development.de/api/v1/webhooks/execute/659068bf-e93a-45c1-8457-6172feb439e7",
  Dahood: "https://api.junkie-development.de/api/v1/webhooks/execute/33f32ef7-1296-4c01-ab90-8b9c62d92c0f",
  Roville: "https://api.junkie-development.de/api/v1/webhooks/execute/2e5f51d5-f6d2-4e15-aeae-f65ea45fd44a",
  VBL: "https://api.junkie-development.de/api/v1/webhooks/execute/aa9f99b0-2800-4a6a-9d3f-27a20ca6f1a4",
  DIG: "https://api.junkie-development.de/api/v1/webhooks/execute/9b6ce52b-ce29-48f3-b3eb-c669549d0d9a",
  JailBird: "https://api.junkie-development.de/api/v1/webhooks/execute/d49c1ac3-8ff2-45fa-b492-877823853427",
  "99Nights": "https://api.junkie-development.de/api/v1/webhooks/execute/9f08a632-34b7-4f89-9f95-2f8ab3733f03",
  "CounterBlox": "https://api.junkie-development.de/api/v1/webhooks/execute/23e4a25b-8794-49e6-ac3c-76b86e23d32d",
  "CounterBloxV2": "https://api.junkie-development.de/api/v1/webhooks/execute/c03c563e-b900-4b0a-aabe-edf944e1ce54",
  NeoTennis: "https://api.junkie-development.de/api/v1/webhooks/execute/e90dc6ca-aa76-42a0-916e-11f2866a15c6",
  BladeBall: "https://api.junkie-development.de/api/v1/webhooks/execute/9460f792-4c8a-4ef1-bd6d-929de7b40add",
  NeoTennisFreeExecutors: "https://api.junkie-development.de/api/v1/webhooks/execute/c0cd2634-68e9-42f8-80c2-8981e52a1cce",
  PlantsvsBrainrots: "https://api.junkie-development.de/api/v1/webhooks/execute/dead7081-4867-472c-91a1-6b44e2b7eddd",
  Hypershot: "https://api.junkie-development.de/api/v1/webhooks/execute/1e02e01e-67ea-49f8-9373-c278ae395840",
  Flick: "https://api.junkie-development.de/api/v1/webhooks/execute/8055e229-733f-4ebd-b7db-077ae38f9f3f",
  DeathBall: "https://api.jnkie.com/api/v1/webhooks/execute/0efd98ce-b036-4d86-ad7a-93347a75f753",
};

// =============================
// 🔄 ANTI-ARCHIVE SYSTEM
// Sends a message every 12 hours to all text channels to prevent auto-archiving
// =============================
const ANTI_ARCHIVE_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours (43,200,000 ms)
const ANTI_ARCHIVE_MESSAGES = [".", "·", "•", "‎"]; // Various subtle characters

function getRandomMessage() {
  return ANTI_ARCHIVE_MESSAGES[Math.floor(Math.random() * ANTI_ARCHIVE_MESSAGES.length)];
}

async function preventArchiving() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;

    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) return;

    const textChannels = channels.filter(
      (ch) => ch?.isTextBased() && !ch.isThread() && ch.type === 0 // type 0 = GUILD_TEXT
    );

    for (const [, channel] of textChannels) {
      try {
        const msg = await channel.send(getRandomMessage());
        // Delete after 1 second
        setTimeout(async () => {
          await msg.delete().catch(() => {});
        }, 1000);
      } catch (err) {
        // Silently skip channels where bot lacks permissions
      }
    }
  } catch (err) {
    console.error("Anti-archive error:", err);
  }
}

// =============================
// 🧱 REGISTER SLASH COMMANDS
// =============================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("genkey")
      .setDescription("Generate a 24-hour Premium key for a user")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to send key to").setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("service")
          .setDescription("Select service/game")
          .addChoices(...Object.keys(WEBHOOKS).map((s) => ({ name: s, value: s })))
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("resendkey")
      .setDescription("Resend a user's last generated key")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to DM").setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show current webhook & system status")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("overview")
      .setDescription("Show full key system analytics overview")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Create a key panel with service buttons")
      .addChannelOption((opt) =>
        opt.setName("channel").setDescription("Channel to send panel").setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("roles")
          .setDescription("Comma-separated role IDs that can use buttons")
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("paypal")
      .setDescription("Create a PayPal payment link for a customer")
      .addNumberOption((opt) => opt.setName("price").setDescription("Price in USD").setRequired(true))
      .addChannelOption((opt) =>
        opt.setName("channel").setDescription("Channel to send link").setRequired(true)
      )
      .addStringOption((opt) => opt.setName("description").setDescription("Payment purpose").setRequired(false))
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to tag (also stored in custom_id)").setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("antiarchive")
      .setDescription("Manually trigger anti-archive (sends subtle messages to all channels)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("[+] Slash commands registered!");
}

// =============================
// 📊 JUNKIE DEVELOPMENT API (overview)
// =============================
async function getJunkieOverview() {
  if (!JUNKIE_API_URL || !JUNKIE_API_KEY) {
    throw new Error("Junkie API not configured (JUNKIE_API_URL / JUNKIE_API_KEY).");
  }
  const res = await fetch(`${JUNKIE_API_URL}/analytics/overview`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${JUNKIE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Junkie API Error ${res.status}: ${text}`);
  }
  return res.json();
}

// =============================
// 🔑 GENERATE KEY HELPERS
// =============================
async function generateKey(user, service, interaction, generatedByTag = null) {
  const webhookUrl = WEBHOOKS[service];
  if (!webhookUrl) throw new Error(`Unknown service: ${service}`);

  const type = "Premium";
  const hours = 24;

  const payload = JSON.stringify({
    item: { product: { name: `${type} Key` }, quantity: 1 },
    user: { id: user.id, discord: user.tag },
    meta: { service, hours },
  });

  const signature = crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", [HMAC_HEADER]: signature },
    body: payload,
  }).catch((err) => {
    throw new Error(`Webhook POST failed for ${service}: ${err.message}`);
  });

  const rawResponse = (await res.text()).trim();
  let key = null;
  try {
    const parsed = JSON.parse(rawResponse);
    key = parsed.key || parsed.data?.key || null;
  } catch {
    key = rawResponse.trim();
  }

  if (!key || key.length < 8) throw new Error(`Invalid key returned for ${service} (${rawResponse.slice(0, 300)})`);

  // DM the user
  try {
    await user.send(
      `🎟️ **Your Premium key for ${service}**\n\`\`\`${key}\`\`\`\n⏰ Valid for ${hours}h`
    );
  } catch {
    // Fallback to ephemeral follow-up
    if (interaction && interaction.followUp) {
      await interaction.followUp({
        content: `⚠️ Could not DM ${user.tag}. Key: \`${key}\``,
        ephemeral: true,
      });
    }
  }

  // Save for resendkey
  keyStore.set(user.id, { service, key, expiresAt: Date.now() + hours * 3600 * 1000 });

  // Log channel
  try {
    if (LOG_CHANNEL_ID) {
      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setColor("#00b0f4")
          .setTitle("🎟️ New Key Generated")
          .addFields(
            { name: "Service", value: service, inline: true },
            { name: "Duration", value: `${hours}h`, inline: true },
            { name: "User", value: user.tag, inline: true },
            { name: "Generated By", value: generatedByTag || (interaction?.user?.tag || "Unknown"), inline: true },
            { name: "Key", value: `\`\`\`${key}\`\`\`` }
          )
          .setFooter({ text: "Nexus Softworks | Key Logger" })
          .setTimestamp();
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch {}
}

// =============================
// ⚡ INTERACTION HANDLER
// =============================
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    // role check + basic cooldown for slash commands
    if (interaction.isChatInputCommand()) {
      if (!interaction.member.roles?.cache?.has(STAFF_ROLE_ID)) {
        await interaction.reply({ content: "❌ You don't have permission.", ephemeral: true });
        return;
      }
      if (cooldowns.has(interaction.user.id)) {
        await interaction.reply({
          content: "⏳ Slow down — wait 5 seconds before using another command.",
          ephemeral: true,
        });
        return;
      }
      cooldowns.add(interaction.user.id);
      setTimeout(() => cooldowns.delete(interaction.user.id), 5000);
    }

    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // --- genkey ---
      if (commandName === "genkey") {
        await interaction.deferReply({ ephemeral: true });
        const user = interaction.options.getUser("user");
        const service = interaction.options.getString("service");

        try {
          await generateKey(user, service, interaction, interaction.user.tag);
          await interaction.editReply(`✅ ${service} key generated and sent to ${user.tag}.`);
        } catch (err) {
          console.error("genkey error:", err);
          await interaction.editReply(`⚠️ Failed to generate key for ${user.tag}: ${err.message || err}`);
        }
      }

      // --- resendkey ---
      else if (commandName === "resendkey") {
        await interaction.deferReply({ ephemeral: true });
        const user = interaction.options.getUser("user");
        const data = keyStore.get(user.id);
        if (!data) {
          await interaction.editReply(`⚠️ No saved key found for ${user.tag}.`);
        } else {
          const remainingHrs = Math.max(0, Math.floor((data.expiresAt - Date.now()) / 3600000));
          try {
            await user.send(
              `📩 **Re-sent your ${data.service} key**\n\`\`\`${data.key}\`\`\`\n⏰ Still valid for ${remainingHrs}h`
            );
            await interaction.editReply(`✅ Key resent to ${user.tag}`);
          } catch {
            await interaction.editReply("⚠️ Could not DM user.");
          }
        }
      }

      // --- status ---
      else if (commandName === "status") {
        await interaction.deferReply({ ephemeral: true });
        const results = [];
        for (const [service, url] of Object.entries(WEBHOOKS)) {
          try {
            // HEAD is lightweight; some endpoints may not support HEAD well so fallback to GET
            let ok = false;
            try {
              const res = await fetch(url, { method: "HEAD", redirect: "manual", timeout: 5000 });
              ok = res.ok;
            } catch {
              const res = await fetch(url, { method: "GET", redirect: "manual", timeout: 5000 });
              ok = res.ok;
            }
            results.push({ service, status: ok ? "✅ Online" : "❌ Unreachable" });
          } catch (err) {
            results.push({ service, status: "❌ Offline" });
          }
        }
        const embed = new EmbedBuilder()
          .setColor("#2f3136")
          .setTitle("📊 Nexus Key System Status")
          .setDescription(results.map((r) => `**${r.service}:** ${r.status}`).join("\n"))
          .setFooter({ text: "Nexus Softworks | System Monitor" })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }

      // --- overview ---
      else if (commandName === "overview") {
        await interaction.deferReply({ ephemeral: true });
        try {
          const data = await getJunkieOverview();
          const topCountries = (data.top_countries || [])
            .slice(0, 5)
            .map((c, i) => `${i + 1}. ${c.country} — ${c.events} events`)
            .join("\n") || "No data";

          const topExecutors = (data.top_executors || [])
            .slice(0, 5)
            .map((x, i) => `${i + 1}. ${x.name} — ${x.events} events`)
            .join("\n") || "No data";

          const embed = new EmbedBuilder()
            .setColor("#5865F2")
            .setTitle("🧩 Key System Overview")
            .setDescription("💎 **Premium Account – Full Analytics Access**")
            .addFields(
              { name: "📈 Clicks", value: `${data.clicks ?? 0}`, inline: true },
              { name: "✅ Checkpoints", value: `${data.checkpoints ?? 0}`, inline: true },
              { name: "🔑 Keys Created", value: `${data.keys_created ?? 0}`, inline: true },
              { name: "🎟️ Keys Generated", value: `${data.keys_generated ?? 0}`, inline: true },
              { name: "🧾 Keys Used", value: `${data.keys_used ?? 0}`, inline: true },
              { name: "⚙️ Script Executions", value: `${data.script_executions ?? 0}`, inline: true },
              { name: "🌍 Top 5 Countries", value: topCountries, inline: false },
              { name: "👥 Top 5 Executors", value: topExecutors, inline: false }
            )
            .setFooter({ text: "Nexus Softworks | Premium Analytics" })
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
        } catch (err) {
          console.error("Junkie API Error:", err);
          await interaction.editReply("⚠️ Failed to fetch analytics overview from Junkie API.");
        }
      }

      // --- panel ---
      else if (commandName === "panel") {
        await interaction.deferReply({ ephemeral: true });
        try {
          const channel = interaction.options.getChannel("channel");
          const rolesInput = interaction.options.getString("roles");
          const roleIds = rolesInput.split(",").map((r) => r.trim());

          const embed = new EmbedBuilder()
            .setColor("#00aaff")
            .setAuthor({ name: "Nexus Softworks | Premium Access" })
            .setTitle("🎯 Key Generation Panel")
            .setDescription("💎 **Premium Members** can use this panel.\n> ⚠️ Misuse or spam will lead to loss of your Premium role.")
            .setFooter({ text: "Nexus Softworks | Automated Key System" })
            .setTimestamp();

          // Build button rows (max 5 buttons per row)
          const services = Object.keys(WEBHOOKS);
          const rows = [];
          for (let i = 0; i < services.length; i += 5) {
            const row = new ActionRowBuilder().addComponents(
              ...services.slice(i, i + 5).map((service) =>
                new ButtonBuilder().setCustomId(`panel_${service}`).setLabel(service).setStyle(ButtonStyle.Primary)
              )
            );
            rows.push(row);
          }

          const files = fs.existsSync(BYPASS_GIF_PATH) ? [BYPASS_GIF_PATH] : [];
          if (files.length) {
            embed.setImage("attachment://nexus-nexushvh.gif");
          }

          const msg = await channel.send({ embeds: [embed], components: rows, files });

          panelPermissions[msg.id] = roleIds;
          savePanels();
          await interaction.editReply(`✅ Panel created in ${channel} with ${roleIds.length} allowed role(s).`);
        } catch (err) {
          console.error("panel error:", err);
          await interaction.editReply("⚠️ Failed to create panel.");
        }
      }

      // --- paypal ---
      else if (commandName === "paypal") {
        await interaction.deferReply({ ephemeral: true });
        const amount = interaction.options.getNumber("price");
        const desc = interaction.options.getString("description") || "Payment";
        const targetUser = interaction.options.getUser("user");
        const channel = interaction.options.getChannel("channel");

        // Check if PayPal is configured
        if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
          await interaction.editReply("⚠️ PayPal is not configured. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env");
          return;
        }

        try {
          const token = await generateAccessToken();
          const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              intent: "CAPTURE",
              purchase_units: [
                {
                  amount: { currency_code: "USD", value: amount.toFixed(2) },
                  description: desc,
                  custom_id: targetUser ? targetUser.id : null,
                },
              ],
              application_context: {
                brand_name: "Nexus Softworks",
                return_url: `${PUBLIC_URL}/paypal/success`,
                cancel_url: `${PUBLIC_URL}/paypal/cancel`,
              },
            }),
          });

          if (!orderRes.ok) {
            const txt = await orderRes.text();
            throw new Error(`PayPal order create failed: ${orderRes.status} ${txt}`);
          }

          const order = await orderRes.json();
          const approvalLink = order?.links?.find((l) => l.rel === "approve")?.href;
          if (!approvalLink) throw new Error(`No approval link: ${JSON.stringify(order)}`);

          const embed = new EmbedBuilder()
            .setColor("#0070ba")
            .setTitle("💳 PayPal Checkout")
            .setDescription(`${targetUser ? `${targetUser}, ` : ""}click below to complete your payment.\n\n**Amount:** $${amount}\n**For:** ${desc}`)
            .addFields({ name: "Payment Link", value: `[Pay Now](${approvalLink})` })
            .setFooter({ text: "Nexus Softworks | PayPal Gateway" })
            .setTimestamp();

          await interaction.editReply({ content: `✅ Sent PayPal link to ${channel}`, embeds: [embed] });
          if (channel && channel.isTextBased()) await channel.send({ embeds: [embed] });
        } catch (err) {
          console.error("PayPal error:", err);
          await interaction.editReply("⚠️ Failed to create PayPal order.");
        }
      }

      // --- antiarchive ---
      else if (commandName === "antiarchive") {
        await interaction.deferReply({ ephemeral: true });
        try {
          await interaction.editReply("⏳ Running anti-archive on all channels...");
          await preventArchiving();
          await interaction.editReply("✅ Anti-archive completed! Sent subtle messages to all text channels.");
        } catch (err) {
          console.error("Manual anti-archive error:", err);
          await interaction.editReply("⚠️ Failed to run anti-archive. Check console for errors.");
        }
      }
    }

    // ====== Panel Buttons ======
    if (interaction.isButton()) {
      const service = interaction.customId.replace("panel_", "");
      const allowedRoles = panelPermissions[interaction.message.id] || [];
      const member = interaction.member;

      if (!allowedRoles.some((r) => member.roles.cache.has(r))) {
        return interaction.reply({
          content: "🚫 You are not a premium member and cannot generate keys here.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        await generateKey(member.user, service, interaction, "Panel Button");
        await interaction.editReply(`✅ Sent your ${service} key in DMs.`);
      } catch (err) {
        console.error("panel button generateKey error:", err);
        await interaction.followUp({ content: "⚠️ Failed to generate key. Try again later.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
  }
});

// =============================
// 🔗 BYPASS LINK HANDLER (messageCreate)
// =============================
const URL_REGEX = /(https?:\/\/[^\s<>"]+)/i;
const bypassCooldown = new Set();
const BYPASS_COOLDOWN_SECONDS = 5;

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;
    if (!BYPASS_CHANNEL_ID || String(message.channel.id) !== String(BYPASS_CHANNEL_ID)) return;

    const match = message.content.match(URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    const cooldownKey = `${message.channel.id}:${message.author.id}`;
    if (bypassCooldown.has(cooldownKey)) return;
    bypassCooldown.add(cooldownKey);
    setTimeout(() => bypassCooldown.delete(cooldownKey), BYPASS_COOLDOWN_SECONDS * 1000);

    // Step 1: Reply immediately
    const reply = await message.reply({
      content: `⏳ <@${message.author.id}> Bypassing your link...`,
    });

    // Step 2: Fetch bypass API
    const endpoint = `${BYPASS_API_URL}?url=${encodeURIComponent(inputUrl)}`;
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { "x-api-key": BYPASS_API_KEY, Accept: "application/json" },
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}

    let resultLink = json?.link || json?.url || json?.result || json?.data?.link || json?.data?.url;
    if (!resultLink && typeof text === "string" && text.trim()) {
      const firstUrl = (text.match(URL_REGEX) || [])[0];
      resultLink = firstUrl || text.trim().slice(0, 1500);
    }
    if (!resultLink) resultLink = "⚠️ No usable result returned by API.";

    // Step 3: Build embed and edit reply
    const embed = new EmbedBuilder()
      .setTitle("🔓 Link Bypassed")
      .setColor(res.ok ? "#3ba55d" : "#e74c3c")
      .setDescription(`<@${message.author.id}>, your bypass result is below:`)
      .addFields(
        { name: "Original Link", value: inputUrl, inline: false },
        { name: "Bypassed Result", value: resultLink, inline: false }
      )
      .setFooter({ text: "Nexus Softworks | Bypass Service" })
      .setTimestamp();

    const files = [];
    if (fs.existsSync(BYPASS_GIF_PATH)) {
      files.push(BYPASS_GIF_PATH);
      embed.setThumbnail("attachment://nexus-nexushvh.gif");
    }

    await reply.edit({
      content: `<@${message.author.id}>`,
      embeds: [embed],
      files,
    });

    // Step 4: Delete original message & bot reply after 120s
    setTimeout(async () => {
      await message.delete().catch(() => {});
      await reply.delete().catch(() => {});
    }, 120000);
  } catch (err) {
    console.error("Bypass handler error:", err);
  }
});

// =============================
// 💳 PAYPAL WEBHOOK (capture & role assign)
// Expect PayPal webhook events you configured in the PayPal dashboard
// =============================
app.post("/paypal/webhook", async (req, res) => {
  try {
    const event = req.body;
    // For production, you should validate the webhook via PayPal API using the webhook ID + signature verification.
    // Here we process a successful capture/approved order event.
    if (event?.event_type === "CHECKOUT.ORDER.APPROVED" || event?.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      // Many PayPal webhook payload structures exist; try to extract order id and custom_id
      const resource = event.resource || event;
      const orderId = resource?.id || resource?.resource?.id || null;
      const buyerDiscordId =
        resource?.purchase_units?.[0]?.custom_id ||
        resource?.custom_id ||
        resource?.resource?.purchase_units?.[0]?.custom_id ||
        null;

      // If CHECKOUT.ORDER.APPROVED we should capture:
      try {
        if (orderId) {
          const token = await generateAccessToken();
          // Attempt to capture (idempotent if already captured)
          await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      } catch (err) {
        console.error("PayPal capture error (non-fatal):", err);
      }

      // Add premium role if buyerDiscordId present
      try {
        if (buyerDiscordId && PREMIUM_ROLE_ID) {
          const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch(buyerDiscordId).catch(() => null);
            if (member) await member.roles.add(PREMIUM_ROLE_ID).catch(() => {});
          }
        }
      } catch (err) {
        console.error("Assign premium role error:", err);
      }

      // optional: log the payment event to LOG_CHANNEL_ID
      try {
        if (LOG_CHANNEL_ID) {
          const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setColor("#3ba55d")
              .setTitle("✅ Payment Completed")
              .addFields(
                { name: "Order ID", value: orderId || "unknown", inline: true },
                { name: "Buyer (custom_id)", value: buyerDiscordId || "none", inline: true }
              )
              .setFooter({ text: "Nexus Softworks | PayPal Tracker" })
              .setTimestamp();
            await logChannel.send({ embeds: [embed] }).catch(() => {});
          }
        }
      } catch {}
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// small health-check
app.get("/healthz", (req, res) => res.send("ok"));

// =============================
// 🚀 START BOT
// =============================
client.once("ready", async () => {
  console.log(`[+] Logged in as ${client.user.tag}`);
  await registerCommands().catch((err) => console.error("registerCommands failed:", err));
  
  // Start anti-archive system
  console.log("[+] Anti-archive system enabled (12 hour interval)");
  setInterval(preventArchiving, ANTI_ARCHIVE_INTERVAL);
});

(async () => {
  try {
    await client.login(TOKEN);
    app.listen(PORT, () => console.log(`[+] Webhook running on port ${PORT}`));
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
})();
