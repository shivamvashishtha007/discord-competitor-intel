/**
 * Discord Competitor Intel - GitHub Actions Worker
 *
 * Runs every 15 minutes from GitHub Actions.
 * Reads latest messages from your own Discord server channels.
 * Sends them to Apps Script Web App.
 * Apps Script stores/classifies/dedupes.
 * If Apps Script returns alertSent = Yes, this script posts alert to Discord.
 */

const CONFIG = {
  DISCORD_API_BASE: 'https://discord.com/api/v10',

  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,

  LDPLAYER_FEED_CHANNEL_ID: process.env.LDPLAYER_FEED_CHANNEL_ID,
  MANUAL_INTAKE_CHANNEL_ID: process.env.MANUAL_INTAKE_CHANNEL_ID,
  COMPETITOR_ALERTS_CHANNEL_ID: process.env.COMPETITOR_ALERTS_CHANNEL_ID,

  APPS_SCRIPT_WEB_APP_URL: process.env.APPS_SCRIPT_WEB_APP_URL,
  SCRIPT_SECRET: process.env.SCRIPT_SECRET,

  MESSAGE_LIMIT_PER_CHANNEL: Number(process.env.MESSAGE_LIMIT_PER_CHANNEL || 50),

  SOURCE_CHANNELS: [
    {
      key: 'ldplayer-feed',
      competitor: 'LDPlayer',
      channelId: process.env.LDPLAYER_FEED_CHANNEL_ID
    },
    {
      key: 'manual-intake',
      competitor: 'Manual Intake',
      channelId: process.env.MANUAL_INTAKE_CHANNEL_ID
    }
  ]
};

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

async function main() {
  validateConfig();

  console.log('Starting Discord Competitor Intel check...');
  console.log(`Message limit per channel: ${CONFIG.MESSAGE_LIMIT_PER_CHANNEL}`);

  const allUpdates = [];

  for (const source of CONFIG.SOURCE_CHANNELS) {
    if (!source.channelId) {
      console.log(`Skipping ${source.key}: missing channel ID`);
      continue;
    }

    console.log(`Reading channel: ${source.key}`);

    const messages = await getDiscordMessages(source.channelId, CONFIG.MESSAGE_LIMIT_PER_CHANNEL);

    console.log(`Fetched ${messages.length} message(s) from ${source.key}`);

    const updates = messages
      .map(message => buildUpdatePayload(source, message))
      .filter(update => update.originalText && update.originalText.trim() !== '[No readable text found]');

    allUpdates.push(...updates);
  }

  if (allUpdates.length === 0) {
    console.log('No readable updates found.');
    return;
  }

  console.log(`Sending ${allUpdates.length} update(s) to Apps Script...`);

  const appsScriptResponse = await sendToAppsScript(allUpdates);

  if (!appsScriptResponse.ok) {
    throw new Error(`Apps Script returned error: ${JSON.stringify(appsScriptResponse)}`);
  }

  console.log(`Apps Script processed: ${appsScriptResponse.processedCount || 0}`);
  console.log(`Apps Script duplicates: ${appsScriptResponse.duplicateCount || 0}`);

  const results = appsScriptResponse.results || [];

  let alertsPosted = 0;

  for (const result of results) {
    if (result.status === 'processed' && result.alertSent === 'Yes' && result.alertMessage) {
      await postDiscordAlert(result.alertMessage);
      alertsPosted++;
    }
  }

  console.log(`Alerts posted to Discord: ${alertsPosted}`);
  console.log('Run completed.');
}

/**
 * Discord API
 */

async function getDiscordMessages(channelId, limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 50), 100));

  const url = `${CONFIG.DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}/messages?limit=${safeLimit}`;

  const response = await discordFetch(url, {
    method: 'GET'
  });

  if (!Array.isArray(response)) {
    return [];
  }

  // Discord returns newest first. Apps Script dedupes by message ID anyway.
  return response;
}

async function postDiscordAlert(content) {
  const url = `${CONFIG.DISCORD_API_BASE}/channels/${encodeURIComponent(CONFIG.COMPETITOR_ALERTS_CHANNEL_ID)}/messages`;

  const payload = {
    content: truncate(content, 1900),
    allowed_mentions: {
      parse: []
    }
  };

  await discordFetch(url, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

async function discordFetch(url, options = {}) {
  const finalOptions = {
    ...options,
    headers: {
      Authorization: `Bot ${CONFIG.DISCORD_BOT_TOKEN}`,
      'User-Agent': 'discord-competitor-intel-github-actions/1.0',
      ...(options.headers || {})
    }
  };

  let response = await fetch(url, finalOptions);
  let text = await response.text();

  if (response.status === 429) {
    let retryAfterSeconds = 3;

    try {
      const rateLimitData = JSON.parse(text);
      retryAfterSeconds = Math.ceil(Number(rateLimitData.retry_after || 3));
    } catch (error) {
      retryAfterSeconds = 3;
    }

    console.log(`Discord rate limit hit. Waiting ${retryAfterSeconds + 1}s...`);
    await sleep((retryAfterSeconds + 1) * 1000);

    response = await fetch(url, finalOptions);
    text = await response.text();
  }

  if (!response.ok) {
    throw new Error(`Discord API error ${response.status}: ${text}`);
  }

  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

/**
 * Apps Script API
 */

async function sendToAppsScript(updates) {
  const payload = {
    secret: CONFIG.SCRIPT_SECRET,
    updates
  };

  const response = await fetch(CONFIG.APPS_SCRIPT_WEB_APP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Apps Script HTTP error ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Apps Script returned non-JSON response: ${text}`);
  }
}

/**
 * Message extraction
 */

function buildUpdatePayload(source, message) {
  const originalText = extractDiscordText(message);

  return {
    timestamp: message.timestamp || new Date().toISOString(),
    competitor: source.competitor,
    sourceChannel: source.key,
    author: extractAuthor(message),
    originalText,
    discordMessageId: message.id,
    discordLink: makeDiscordMessageLink(CONFIG.DISCORD_GUILD_ID, source.channelId, message.id),
    rawJsonSnippet: truncate(JSON.stringify(message), 45000)
  };
}

function extractDiscordText(message) {
  const parts = [];

  if (message.content) {
    parts.push(message.content);
  }

  if (Array.isArray(message.embeds)) {
    for (const embed of message.embeds) {
      if (embed.title) parts.push(embed.title);
      if (embed.description) parts.push(embed.description);
      if (embed.url) parts.push(embed.url);

      if (embed.author && embed.author.name) {
        parts.push(embed.author.name);
      }

      if (Array.isArray(embed.fields)) {
        for (const field of embed.fields) {
          if (field.name) parts.push(field.name);
          if (field.value) parts.push(field.value);
        }
      }

      if (embed.footer && embed.footer.text) {
        parts.push(embed.footer.text);
      }
    }
  }

  if (Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      if (attachment.filename) parts.push(`Attachment: ${attachment.filename}`);
      if (attachment.url) parts.push(attachment.url);
    }
  }

  const text = cleanText(parts.join('\n'));

  return text || '[No readable text found]';
}

function extractAuthor(message) {
  const parts = [];

  if (message.author) {
    if (message.author.global_name) parts.push(message.author.global_name);
    if (message.author.username) parts.push(message.author.username);
  }

  if (message.webhook_id) {
    parts.push('Webhook/Followed Channel');
  }

  return parts.join(' / ') || 'Unknown';
}

/**
 * Helpers
 */

function validateConfig() {
  const missing = [];

  const requiredKeys = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_GUILD_ID',
    'LDPLAYER_FEED_CHANNEL_ID',
    'MANUAL_INTAKE_CHANNEL_ID',
    'COMPETITOR_ALERTS_CHANNEL_ID',
    'APPS_SCRIPT_WEB_APP_URL',
    'SCRIPT_SECRET'
  ];

  for (const key of requiredKeys) {
    if (!CONFIG[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function makeDiscordMessageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncate(text, maxLength) {
  const value = String(text || '');

  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength - 20) + '... [truncated]';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
