// E2B Sandbox API Test
const E2B_API_KEY = 'e2b_3873786978c25a564f54331d29fe9de6ca579f7a';
const E2B_API_BASE = 'https://api.e2b.dev';

async function test() {
  console.log('1. Creating sandbox...');
  const createResp = await fetch(`${E2B_API_BASE}/sandboxes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': E2B_API_KEY },
    body: JSON.stringify({ templateID: 'base', timeout: 300 }),
  });
  const createData = await createResp.json();
  console.log('   Create result:', JSON.stringify(createData));

  if (!createData.sandboxID) {
    console.error('Failed to create sandbox');
    return;
  }

  const { sandboxID, clientID } = createData;
  console.log(`   Sandbox: ${sandboxID}, Client: ${clientID}`);

  // The envd API runs on the sandbox-specific domain at the default envd port
  const envdBase = `https://49982-${sandboxID}-${clientID}.e2b.dev`;

  console.log('\n2. Running command via envd...');
  try {
    const cmdResp = await fetch(`${envdBase}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'echo Hello from E2B! && uname -a && whoami', timeout: 10 }),
      signal: AbortSignal.timeout(15000),
    });
    const cmdData = await cmdResp.text();
    console.log('   Command result:', cmdData);
  } catch (e) {
    console.log('   envd error:', e.message);
  }

  // Try central API v1 approach
  console.log('\n3. Running command via central API...');
  try {
    const cmdResp2 = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxID}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': E2B_API_KEY },
      body: JSON.stringify({ cmd: 'echo Hello', timeout: 10 }),
      signal: AbortSignal.timeout(15000),
    });
    const cmdData2 = await cmdResp2.text();
    console.log('   Central API result:', cmdData2);
  } catch (e) {
    console.log('   Central API error:', e.message);
  }

  // Cleanup
  console.log('\n4. Destroying sandbox...');
  const delResp = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxID}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': E2B_API_KEY },
  });
  console.log('   Delete status:', delResp.status);
}

test().catch(e => console.error('Fatal:', e));
