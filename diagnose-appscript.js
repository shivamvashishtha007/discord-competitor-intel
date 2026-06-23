/**
 * Diagnose Apps Script Web App access from GitHub Actions.
 *
 * Tests:
 * 1. Whether GitHub can access APPS_SCRIPT_WEB_APP_URL with GET
 * 2. Whether POST ping works with SCRIPT_SECRET
 * 3. Whether POST sample update works with SCRIPT_SECRET
 *
 * Does NOT call Discord.
 */

const CONFIG = {
  APPS_SCRIPT_WEB_APP_URL: process.env.APPS_SCRIPT_WEB_APP_URL,
  SCRIPT_SECRET: process.env.SCRIPT_SECRET
};

main().catch(error => {
  console.error('Fatal diagnostic error:', error);
  process.exit(1);
});

async function main() {
  validateConfig();

  console.log('Starting Apps Script diagnostics...');
  printMaskedConfig();

  await testGet();
  await testPostPing();
  await testPostSampleUpdate();

  console.log('Diagnostics completed successfully.');
}

function validateConfig() {
  const missing = [];

  if (!CONFIG.APPS_SCRIPT_WEB_APP_URL) missing.push('APPS_SCRIPT_WEB_APP_URL');
  if (!CONFIG.SCRIPT_SECRET) missing.push('SCRIPT_SECRET');

  if (missing.length) {
    throw new Error(`Missing GitHub secret(s): ${missing.join(', ')}`);
  }

  if (!CONFIG.APPS_SCRIPT_WEB_APP_URL.includes('/exec')) {
    console.warn('WARNING: APPS_SCRIPT_WEB_APP_URL does not contain /exec. This is usually wrong.');
  }

  if (CONFIG.APPS_SCRIPT_WEB_APP_URL.includes('/dev')) {
    console.warn('WARNING: APPS_SCRIPT_WEB_APP_URL contains /dev. GitHub should use /exec, not /dev.');
  }

  if (CONFIG.APPS_SCRIPT_WEB_APP_URL.includes('/edit')) {
    console.warn('WARNING: APPS_SCRIPT_WEB_APP_URL contains /edit. This is wrong.');
  }

  if (CONFIG.APPS_SCRIPT_WEB_APP_URL.includes('drive.google.com')) {
    console.warn('WARNING: APPS_SCRIPT_WEB_APP_URL contains drive.google.com. This is wrong.');
  }
}

function printMaskedConfig() {
  const url = CONFIG.APPS_SCRIPT_WEB_APP_URL.trim();

  console.log('Masked Apps Script URL check:');
  console.log(`- Starts with https://script.google.com/macros/s/: ${url.startsWith('https://script.google.com/macros/s/')}`);
  console.log(`- Ends with /exec: ${url.endsWith('/exec')}`);
  console.log(`- Contains /dev: ${url.includes('/dev')}`);
  console.log(`- Contains /edit: ${url.includes('/edit')}`);
  console.log(`- URL length: ${url.length}`);
  console.log(`- First 45 chars: ${url.slice(0, 45)}`);
  console.log(`- Last 12 chars: ${url.slice(-12)}`);
  console.log(`- SCRIPT_SECRET configured: ${CONFIG.SCRIPT_SECRET.length > 0}`);
  console.log(`- SCRIPT_SECRET length: ${CONFIG.SCRIPT_SECRET.length}`);
}

async function testGet() {
  console.log('\nTEST 1: GET Apps Script URL');

  const response = await fetch(CONFIG.APPS_SCRIPT_WEB_APP_URL.trim(), {
    method: 'GET',
    redirect: 'follow'
  });

  const text = await response.text();

  console.log(`GET status: ${response.status}`);
  console.log(`GET content-type: ${response.headers.get('content-type') || 'unknown'}`);
  console.log(`GET final URL: ${response.url}`);
  console.log(`GET response first 500 chars:\n${text.slice(0, 500)}`);

  if (!response.ok) {
    throw new Error(`GET failed with status ${response.status}. Apps Script URL is not publicly accessible from GitHub.`);
  }

  try {
    const json = JSON.parse(text);
    console.log('GET JSON parsed successfully:', JSON.stringify(json));
  } catch (err) {
    throw new Error('GET did not return JSON. GitHub is not reaching your Apps Script doGet endpoint.');
  }
}

async function testPostPing() {
  console.log('\nTEST 2: POST ping with SCRIPT_SECRET');

  const payload = {
    secret: CONFIG.SCRIPT_SECRET,
    action: 'ping'
  };

  const response = await fetch(CONFIG.APPS_SCRIPT_WEB_APP_URL.trim(), {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  const text = await response.text();

  console.log(`POST ping status: ${response.status}`);
  console.log(`POST ping content-type: ${response.headers.get('content-type') || 'unknown'}`);
  console.log(`POST ping final URL: ${response.url}`);
  console.log(`POST ping response first 800 chars:\n${text.slice(0, 800)}`);

  if (!response.ok) {
    throw new Error(`POST ping failed with status ${response.status}.`);
  }

  let json;

  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error('POST ping did not return JSON. Apps Script doPost is not being reached.');
  }

  if (!json.ok) {
    throw new Error(`POST ping returned ok:false: ${JSON.stringify(json)}`);
  }

  console.log('POST ping successful:', JSON.stringify(json));
}

async function testPostSampleUpdate() {
  console.log('\nTEST 3: POST sample update');

  const payload = {
    secret: CONFIG.SCRIPT_SECRET,
    update: {
      timestamp: new Date().toISOString(),
      competitor: 'LDPlayer',
      sourceChannel: 'github-diagnostic',
      author: 'GitHub Diagnostic',
      originalText: 'Diagnostic test: LDPlayer released a version update with performance fixes and FPS optimization.',
      discordMessageId: 'github-diagnostic-' + Date.now(),
      discordLink: '',
      rawJsonSnippet: ''
    }
  };

  const response = await fetch(CONFIG.APPS_SCRIPT_WEB_APP_URL.trim(), {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  const text = await response.text();

  console.log(`POST sample status: ${response.status}`);
  console.log(`POST sample content-type: ${response.headers.get('content-type') || 'unknown'}`);
  console.log(`POST sample final URL: ${response.url}`);
  console.log(`POST sample response first 1200 chars:\n${text.slice(0, 1200)}`);

  if (!response.ok) {
    throw new Error(`POST sample failed with status ${response.status}.`);
  }

  let json;

  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error('POST sample did not return JSON. Apps Script doPost is not being reached.');
  }

  if (!json.ok) {
    throw new Error(`POST sample returned ok:false: ${JSON.stringify(json)}`);
  }

  console.log('POST sample successful:', JSON.stringify(json, null, 2));
}
