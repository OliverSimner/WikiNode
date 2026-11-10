const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const cookieSession = require('cookie-session');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const app = express();
const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
const dataDirectory = path.resolve(process.env.WIKINODE_DATA_DIR || path.join(__dirname, 'data'));
const dataFile = path.join(dataDirectory, 'wiki.json');
const usersFile = path.join(dataDirectory, 'users.json');
const sessionKeyFile = path.join(dataDirectory, 'session-key');
const scrypt = promisify(crypto.scrypt);
let setupInProgress = false;

const articleSanitizer = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'h1', 'h2', 'img', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption'
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height']
  },
  allowedSchemes: ['http', 'https', 'mailto']
};

function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `page-${Date.now()}`;
}

function readPages() {
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
}

function writePages(pages) {
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(pages, null, 2));
  fs.renameSync(temporaryFile, dataFile);
}

function readUsers() {
  return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
}

function writeUsers(users) {
  const temporaryFile = `${usersFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(users, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(temporaryFile, 0o600);
  fs.renameSync(temporaryFile, usersFile);
}

function validUsername(username) {
  return typeof username === 'string'
    && /^[a-zA-Z0-9._-]{3,32}$/.test(username)
    && !['__proto__', 'constructor', 'prototype'].includes(username.toLowerCase());
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128;
}

async function passwordHash(password, salt = crypto.randomBytes(16)) {
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt: salt.toString('hex'), hash: derived.toString('hex') };
}

async function passwordMatches(password, user) {
  const derived = await scrypt(password, Buffer.from(user.salt, 'hex'), 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return crypto.timingSafeEqual(derived, Buffer.from(user.hash, 'hex'));
}

function requireSignedIn(request, response, next) {
  if (!request.user) return response.status(401).json({ error: 'Sign in to continue.' });
  next();
}

function requireAdmin(request, response, next) {
  if (!request.user) return response.status(401).json({ error: 'Sign in as an administrator to continue.' });
  if (request.user.role !== 'admin') return response.status(403).json({ error: 'Administrator access is required.' });
  next();
}

function validAccountInput(request, response) {
  const { username, password } = request.body || {};
  if (!validUsername(username)) {
    response.status(400).json({ error: 'Usernames must be 3–32 letters, numbers, dots, dashes, or underscores.' });
    return false;
  }
  if (!validPassword(password)) {
    response.status(400).json({ error: 'Passwords must be between 12 and 128 characters.' });
    return false;
  }
  return true;
}

function renderMarkdown(markdown) {
  const wikiLinked = markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => {
    const title = target.trim();
    const text = label ? label.trim() : title;
    const href = `#/wiki/${slugify(title)}`;
    return `<a href="${href}">${text.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character])}</a>`;
  });

  return sanitizeHtml(marked.parse(wikiLinked), articleSanitizer);
}

fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
if (process.platform !== 'win32') fs.chmodSync(dataDirectory, 0o700);
if (!fs.existsSync(usersFile)) writeUsers({});
if (!fs.existsSync(sessionKeyFile)) {
  fs.writeFileSync(sessionKeyFile, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
}
let sessionKey = fs.readFileSync(sessionKeyFile, 'utf8').trim();
if (!/^[a-f0-9]{96}$/i.test(sessionKey)) {
  sessionKey = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(sessionKeyFile, sessionKey, { mode: 0o600 });
}
if (process.platform !== 'win32') {
  fs.chmodSync(usersFile, 0o600);
  fs.chmodSync(sessionKeyFile, 0o600);
}
if (!fs.existsSync(dataFile)) {
  const now = new Date().toISOString();
  writePages({
    home: {
      slug: 'home',
      title: 'Welcome to WikiNode',
      revisions: [{
        id: 1,
        content: '# Welcome to WikiNode\n\nA home for the knowledge your community builds together. Start with a page, follow a link, and improve what you find.\n\n## Getting started\n\n- Create a page with the **New page** button.\n- Edit any article to add or correct information.\n- Link articles with the `[[Page title]]` syntax.\n\n## A shared notebook\n\nThis wiki is open to everyone with access to this server. Each edit is kept in the page history, so changes are easy to review. Try opening the [[About WikiNode]] page to learn how this instance works.',
        author: 'WikiNode',
        summary: 'Created the home page',
        createdAt: now
      }]
    },
    'about-wikinode': {
      slug: 'about-wikinode',
      title: 'About WikiNode',
      revisions: [{
        id: 1,
        content: '# About WikiNode\n\nWikiNode is a small, self-hosted wiki built with Node.js. Articles are written in Markdown and stored on the server as revision history.\n\n## Editing pages\n\nSelect **Edit** to improve this page. Use `[[Page title]]` to link to another article; links to pages that do not exist can be created when you visit them.\n\n## Keeping this wiki\n\nThe contents of this wiki live in `data/wiki.json`. Back up that file to keep your articles and their history.',
        author: 'WikiNode',
        summary: 'Created the about page',
        createdAt: now
      }]
    }
  });
}

app.use(express.json({ limit: '1mb' }));
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
}
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again in 15 minutes.' }
});
app.use(cookieSession({
  name: 'wikinode-session',
  keys: [sessionKey],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production'
}));
app.use((request, _response, next) => {
  const username = request.session?.username;
  request.user = username ? readUsers()[username.toLowerCase()] || null : null;
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auth/status', (request, response) => {
  const users = readUsers();
  response.json({
    hasAccounts: Object.keys(users).length > 0,
    user: request.user ? { username: request.user.username, role: request.user.role } : null
  });
});

app.post('/api/auth/first-admin', authLimiter, async (request, response) => {
  if (setupInProgress || Object.keys(readUsers()).length > 0) {
    return response.status(409).json({ error: 'Administrator setup is already complete.' });
  }
  if (!validAccountInput(request, response)) return;

  setupInProgress = true;
  try {
    const users = readUsers();
    if (Object.keys(users).length > 0) return response.status(409).json({ error: 'Administrator setup is already complete.' });
    const credentials = await passwordHash(request.body.password);
    const username = request.body.username.trim();
    users[username.toLowerCase()] = {
      username,
      role: 'admin',
      ...credentials,
      createdAt: new Date().toISOString()
    };
    writeUsers(users);
    request.session = { username };
    response.status(201).json({ username, role: 'admin' });
  } finally {
    setupInProgress = false;
  }
});

app.post('/api/auth/login', authLimiter, async (request, response) => {
  const { username, password } = request.body || {};
  const user = typeof username === 'string' ? readUsers()[username.trim().toLowerCase()] : null;
  if (!user || typeof password !== 'string' || !(await passwordMatches(password, user))) {
    return response.status(401).json({ error: 'The username or password is incorrect.' });
  }
  request.session = { username: user.username };
  response.json({ username: user.username, role: user.role });
});

app.post('/api/auth/logout', (request, response) => {
  request.session = null;
  response.status(204).end();
});

app.get('/api/accounts', requireAdmin, (_request, response) => {
  response.json(Object.values(readUsers()).map(({ username, role, createdAt }) => ({ username, role, createdAt })));
});

app.post('/api/accounts', requireAdmin, async (request, response) => {
  if (!validAccountInput(request, response)) return;
  const users = readUsers();
  const username = request.body.username.trim();
  const key = username.toLowerCase();
  if (users[key]) return response.status(409).json({ error: 'That username is already in use.' });
  const role = request.body.role === 'admin' ? 'admin' : 'editor';
  users[key] = {
    username,
    role,
    ...await passwordHash(request.body.password),
    createdAt: new Date().toISOString()
  };
  writeUsers(users);
  response.status(201).json({ username, role });
});

app.delete('/api/accounts/:username', requireAdmin, (request, response) => {
  const key = request.params.username.toLowerCase();
  const users = readUsers();
  const target = users[key];
  if (!target) return response.status(404).json({ error: 'Account not found.' });
  if (key === request.user.username.toLowerCase()) return response.status(400).json({ error: 'You cannot delete your own account.' });
  const adminCount = Object.values(users).filter((user) => user.role === 'admin').length;
  if (target.role === 'admin' && adminCount === 1) return response.status(400).json({ error: 'The last administrator cannot be deleted.' });
  delete users[key];
  writeUsers(users);
  response.status(204).end();
});

app.post('/api/preview', (request, response) => {
  if (typeof request.body.content !== 'string' || request.body.content.length > 100000) {
    return response.status(400).json({ error: 'Preview content must be under 100,000 characters.' });
  }
  response.json({ html: renderMarkdown(request.body.content) });
});

app.get('/api/pages', (request, response) => {
  const query = String(request.query.q || '').trim().toLowerCase();
  const pages = Object.values(readPages())
    .map((page) => {
      const latest = page.revisions[page.revisions.length - 1];
      return {
        slug: page.slug,
        title: page.title,
        updatedAt: latest.createdAt,
        revisionCount: page.revisions.length
      };
    })
    .filter((page) => !query || page.title.toLowerCase().includes(query))
    .sort((left, right) => left.title.localeCompare(right.title));
  response.json(pages);
});

app.get('/api/recent', (_request, response) => {
  const changes = Object.values(readPages()).flatMap((page) =>
    page.revisions.slice(1).map((revision) => ({
      slug: page.slug,
      title: page.title,
      ...revision
    }))
  );
  changes.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  response.json(changes.slice(0, 12));
});

app.get('/api/admin/overview', requireAdmin, (_request, response) => {
  const pages = Object.values(readPages()).map((page) => {
    const latest = page.revisions[page.revisions.length - 1];
    return {
      slug: page.slug,
      title: page.title,
      updatedAt: latest.createdAt,
      revisionCount: page.revisions.length
    };
  }).sort((left, right) => left.title.localeCompare(right.title));
  response.json({ pages, accountCount: Object.keys(readUsers()).length });
});

app.get('/api/pages/:slug', (request, response) => {
  const page = readPages()[request.params.slug];
  if (!page) return response.status(404).json({ error: 'Page not found' });

  const latest = page.revisions[page.revisions.length - 1];
  response.json({
    slug: page.slug,
    title: page.title,
    content: latest.content,
    html: renderMarkdown(latest.content),
    updatedAt: latest.createdAt,
    author: latest.author,
    summary: latest.summary,
    revisionCount: page.revisions.length
  });
});

app.get('/api/pages/:slug/history', (request, response) => {
  const page = readPages()[request.params.slug];
  if (!page) return response.status(404).json({ error: 'Page not found' });
  response.json(page.revisions.slice().reverse());
});

function validatePageInput(request, response, next) {
  const { title, content, summary } = request.body || {};
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
    return response.status(400).json({ error: 'Title must be between 1 and 120 characters.' });
  }
  if (typeof content !== 'string' || content.length > 100000) {
    return response.status(400).json({ error: 'Page content must be under 100,000 characters.' });
  }
  request.pageInput = {
    title: title.trim(),
    content,
    summary: typeof summary === 'string' ? summary.trim().slice(0, 200) : ''
  };
  next();
}

function savePage(slug, input, existing, author) {
  const pages = readPages();
  if (existing && existing.title.toLowerCase() !== input.title.toLowerCase()) {
    throw new Error('A page with that URL already exists.');
  }

  const page = existing || { slug, title: input.title, revisions: [] };
  const latest = page.revisions[page.revisions.length - 1];
  if (latest && latest.content === input.content && latest.summary === input.summary) {
    return page;
  }

  page.revisions.push({
    id: page.revisions.length + 1,
    content: input.content,
    author: author || 'Wiki contributor',
    summary: input.summary || 'Updated page',
    createdAt: new Date().toISOString()
  });
  pages[slug] = page;
  writePages(pages);
  return page;
}

app.post('/api/pages', requireAdmin, validatePageInput, (request, response) => {
  const slug = slugify(request.pageInput.title);
  const pages = readPages();
  const existing = pages[slug];
  if (existing) return response.status(409).json({ error: 'A page with that title already exists.' });

  const page = savePage(slug, request.pageInput, null);
  response.status(201).json({ slug: page.slug, title: page.title });
});

app.put('/api/pages/:slug', requireSignedIn, validatePageInput, (request, response) => {
  const pages = readPages();
  const existing = pages[request.params.slug];
  if (!existing) return response.status(404).json({ error: 'Page not found' });
  if (existing.title.toLowerCase() !== request.pageInput.title.toLowerCase()) {
    return response.status(400).json({ error: 'Page titles cannot be changed while editing.' });
  }
  const page = savePage(request.params.slug, request.pageInput, existing, request.user.username);
  response.json({ slug: page.slug, title: page.title });
});

app.patch('/api/pages/:slug', requireAdmin, (request, response) => {
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
  if (!title || title.length > 120) return response.status(400).json({ error: 'Title must be between 1 and 120 characters.' });
  const pages = readPages();
  const page = pages[request.params.slug];
  if (!page) return response.status(404).json({ error: 'Page not found.' });
  const newSlug = slugify(title);
  if (newSlug !== request.params.slug && pages[newSlug]) return response.status(409).json({ error: 'A page with that title already exists.' });
  delete pages[request.params.slug];
  page.slug = newSlug;
  page.title = title;
  pages[newSlug] = page;
  writePages(pages);
  response.json({ slug: newSlug, title });
});

app.delete('/api/pages/:slug', requireAdmin, (request, response) => {
  const pages = readPages();
  if (!pages[request.params.slug]) return response.status(404).json({ error: 'Page not found.' });
  if (Object.keys(pages).length === 1) return response.status(400).json({ error: 'The last page cannot be deleted.' });
  delete pages[request.params.slug];
  writePages(pages);
  response.status(204).end();
});

app.get(['/wiki/:slug', '/'], (_request, response) => {
  response.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(port, () => {
  console.log(`WikiNode is running at http://localhost:${server.address().port}`);
});