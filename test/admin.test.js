const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');

test('admin setup, account roles, and page management are protected', async (context) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wikinode-test-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', WIKINODE_DATA_DIR: dataDirectory, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { output += chunk; });

  context.after(async () => {
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => {});
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  let port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const match = output.match(/running at http:\/\/localhost:(\d+)/);
    if (match) {
      port = Number(match[1]);
      break;
    }
    if (server.exitCode !== null) throw new Error(output || 'Test server exited before starting.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(port, `test server did not start: ${output}`);

  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (url, options = {}) => fetch(`${baseUrl}${url}`, options);
  const cookieFrom = (response) => {
    const cookies = response.headers.getSetCookie?.()
      || (response.headers.get('set-cookie') || '').split(/,\s*(?=[^;,]+=)/);
    return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  };
  const jsonOptions = (body, cookie) => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });

  const previewResponse = await request('/api/preview', jsonOptions({
    content: '# Safe heading\n\n**Safe bold**\n\n<img src=x onerror=alert(1)>'
  }));
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.match(preview.html, /<h1>Safe heading<\/h1>/);
  assert.match(preview.html, /<strong>Safe bold<\/strong>/);
  assert.doesNotMatch(preview.html, /onerror/i);

  const status = await (await request('/api/auth/status')).json();
  assert.equal(status.hasAccounts, false);
  assert.equal((await request('/api/admin/overview')).status, 401);

  const setupResponse = await request('/api/auth/first-admin', jsonOptions({
    username: 'AdminTest',
    password: 'TemporaryAdminPassword123!'
  }));
  assert.equal(setupResponse.status, 201);
  const adminCookie = cookieFrom(setupResponse);
  assert.ok(adminCookie);
  assert.equal((await request('/api/admin/overview', { headers: { Cookie: adminCookie } })).status, 200);
  assert.equal((await request('/api/auth/first-admin', jsonOptions({
    username: 'SecondAdmin',
    password: 'TemporaryAdminPassword456!'
  }))).status, 409);

  const modes = {
    directory: fs.statSync(dataDirectory).mode & 0o777,
    users: fs.statSync(path.join(dataDirectory, 'users.json')).mode & 0o777,
    sessionKey: fs.statSync(path.join(dataDirectory, 'session-key')).mode & 0o777
  };
  if (process.platform !== 'win32') {
    assert.equal(modes.directory, 0o700);
    assert.equal(modes.users, 0o600);
    assert.equal(modes.sessionKey, 0o600);
  }

  const createPage = (title, cookie) => request('/api/pages', jsonOptions({ title, content: '# Test', summary: 'Test page' }, cookie));
  const pageResponse = await createPage('Release Test Page', adminCookie);
  assert.equal(pageResponse.status, 201);
  const page = await pageResponse.json();
  assert.equal((await createPage('Release Test Page', adminCookie)).status, 409);

  const accountResponse = await request('/api/accounts', jsonOptions({
    username: 'EditorTest',
    password: 'TemporaryEditorPassword123!',
    role: 'editor'
  }, adminCookie));
  assert.equal(accountResponse.status, 201);
  const loginResponse = await request('/api/auth/login', jsonOptions({
    username: 'EditorTest',
    password: 'TemporaryEditorPassword123!'
  }));
  assert.equal(loginResponse.status, 200);
  const editorCookie = cookieFrom(loginResponse);
  assert.equal((await request('/api/admin/overview', { headers: { Cookie: editorCookie } })).status, 403);
  assert.equal((await request('/api/accounts', { headers: { Cookie: editorCookie } })).status, 403);

  const editResponse = await request(`/api/pages/${page.slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: editorCookie },
    body: JSON.stringify({ title: 'Release Test Page', content: '# Edited', summary: 'Editor update' })
  });
  assert.equal(editResponse.status, 200);
  const history = await (await request(`/api/pages/${page.slug}/history`)).json();
  assert.equal(history[0].author, 'EditorTest');

  const renameResponse = await request(`/api/pages/${page.slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ title: 'Renamed Release Test Page' })
  });
  assert.equal(renameResponse.status, 200);
  const renamedPage = await renameResponse.json();
  assert.equal((await request(`/api/pages/${renamedPage.slug}`, {
    method: 'DELETE', headers: { Cookie: adminCookie }
  })).status, 204);
  assert.equal((await request('/api/accounts/EditorTest', {
    method: 'DELETE', headers: { Cookie: adminCookie }
  })).status, 204);

  let loginAttempt;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    loginAttempt = await request('/api/auth/login', jsonOptions({ username: 'missing', password: 'incorrect' }));
    assert.equal(loginAttempt.status, 401);
  }
  loginAttempt = await request('/api/auth/login', jsonOptions({ username: 'missing', password: 'incorrect' }));
  assert.equal(loginAttempt.status, 429);
});

test('Vercel admin session survives requests routed to a different function instance', async (context) => {
  const firstDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wikinode-vercel-a-'));
  const secondDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wikinode-vercel-b-'));
  const sessionSecret = 'b'.repeat(96);

  async function startInstance(dataDirectory) {
    const server = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        VERCEL: '1',
        NODE_ENV: 'production',
        PORT: '0',
        SESSION_SECRET: sessionSecret,
        WIKINODE_DATA_DIR: dataDirectory
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    server.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    server.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const port = Number(output.match(/running at http:\/\/localhost:(\d+)/)?.[1]);
      if (port) return { server, baseUrl: `http://127.0.0.1:${port}` };
      if (server.exitCode !== null) throw new Error(output || 'Vercel test instance exited before starting.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    server.kill('SIGTERM');
    throw new Error(`Vercel test instance did not start: ${output}`);
  }

  const firstInstance = await startInstance(firstDataDirectory);
  const secondInstance = await startInstance(secondDataDirectory);
  context.after(async () => {
    firstInstance.server.kill('SIGTERM');
    secondInstance.server.kill('SIGTERM');
    await Promise.all([
      once(firstInstance.server, 'exit').catch(() => {}),
      once(secondInstance.server, 'exit').catch(() => {})
    ]);
    fs.rmSync(firstDataDirectory, { recursive: true, force: true });
    fs.rmSync(secondDataDirectory, { recursive: true, force: true });
  });

  const setup = await fetch(`${firstInstance.baseUrl}/api/auth/first-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ username: 'AdminTest', password: 'TemporaryAdminPassword123!' })
  });
  assert.equal(setup.status, 201);
  const cookie = (setup.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ');
  assert.ok(cookie);

  const vercelHeaders = { Cookie: cookie, 'X-Forwarded-Proto': 'https' };
  const authStatus = await fetch(`${secondInstance.baseUrl}/api/auth/status`, { headers: vercelHeaders });
  assert.deepEqual((await authStatus.json()).user, { username: 'AdminTest', role: 'admin' });
  const overview = await fetch(`${secondInstance.baseUrl}/api/admin/overview`, { headers: vercelHeaders });
  assert.equal(overview.status, 200);
});