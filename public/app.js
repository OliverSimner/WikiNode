const workspace = document.querySelector('#workspace');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-input');
const searchResults = document.querySelector('#search-results');

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatDate(value, includeTime = false) {
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  if (includeTime) Object.assign(options, { hour: 'numeric', minute: '2-digit' });
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function route() {
  const parts = decodeURIComponent(location.hash.slice(2) || 'wiki/home').split('/');
  if (parts[0] === 'wiki' && parts[1]) return showPage(parts[1]);
  if (parts[0] === 'edit') return showEditor(parts[1] && parts[1] !== 'new' ? parts[1] : null);
  if (parts[0] === 'history' && parts[1]) return showHistory(parts[1]);
  if (parts[0] === 'all') return showAllPages();
  if (parts[0] === 'recent') return showRecentChanges();
  if (parts[0] === 'login' || parts[0] === 'setup') return showAuthForm(parts[0]);
  if (parts[0] === 'overview') return showOverview();
  if (parts[0] === 'accounts') return showAccounts();
  return showPage('home');
}

async function refreshAuthUi() {
  try {
    const status = await requestJson('/api/auth/status');
    const user = status.user;
    const isAdmin = user?.role === 'admin';
    document.querySelector('#admin-nav').hidden = !isAdmin;
    document.querySelector('#new-page').hidden = !isAdmin;
    document.querySelector('#auth-actions').innerHTML = user
      ? `<span class="signed-in-label">${escapeHtml(user.username)}${isAdmin ? ' · Admin' : ''}</span><button class="auth-button" id="logout-button" type="button">Log out</button>`
      : status.hasAccounts
        ? '<a href="#/login">Log in</a>'
        : '<a href="#/setup">Set up this wiki</a>';
  } catch {
    document.querySelector('#auth-actions').innerHTML = '<a href="#/login">Log in</a>';
  }
}

async function showAuthForm(mode) {
  const isSetup = mode === 'setup';
  const status = await requestJson('/api/auth/status');
  if (isSetup && status.hasAccounts) {
    workspace.innerHTML = '<section class="empty-state"><h1>Setup is complete</h1><p>An administrator account already exists.</p><a class="text-action" href="#/login">Log in</a></section>';
    return;
  }
  if (!isSetup && !status.hasAccounts) {
    location.hash = '#/setup';
    return;
  }

  workspace.innerHTML = `<section class="account-form-view"><div class="eyebrow">${isSetup ? 'FIRST-TIME SETUP' : 'WIKINODE ACCOUNT'}</div>
    <h1>${isSetup ? 'Create the first administrator' : 'Log in'}</h1>
    <p class="listing-intro">${isSetup ? 'This account will manage pages and other accounts.' : 'Sign in to edit pages or manage this wiki.'}</p>
    <form class="editor-form" id="auth-form">
      <label for="auth-username">Username</label><input id="auth-username" name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]+" autocomplete="username" required>
      <label for="auth-password">Password</label><input id="auth-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="${isSetup ? 'new-password' : 'current-password'}" required>
      <div class="editor-actions"><button class="text-action" type="submit">${isSetup ? 'Create administrator' : 'Log in'}</button></div>
      <div class="form-message" id="auth-message" role="status"></div>
    </form></section>`;
  document.title = `${isSetup ? 'Create administrator' : 'Log in'} · WikiNode`;
  document.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = document.querySelector('#auth-message');
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await requestJson(isSetup ? '/api/auth/first-admin' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.get('username'), password: form.get('password') })
      });
      await refreshAuthUi();
      location.hash = '#/overview';
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });
}

async function showOverview() {
  try {
    const { pages, accountCount } = await requestJson('/api/admin/overview');
    workspace.innerHTML = `<section class="listing-view"><div class="article-tabs"><div class="page-tabs"><span class="selected">Site overview</span><a href="#/accounts">Accounts</a></div></div>
      <h1>Site overview</h1><p class="listing-intro">${pages.length} pages · ${accountCount} accounts</p>
      <div class="overview-actions"><a class="text-action" href="#/edit/new">Create page</a><a class="quiet-action" href="#/accounts">Manage accounts</a></div>
      <div class="overview-table-wrap"><table class="overview-table"><thead><tr><th>Page</th><th>Last updated</th><th>Revisions</th><th>Actions</th></tr></thead><tbody>
      ${pages.map((page) => `<tr><td><a href="#/wiki/${encodeURIComponent(page.slug)}">${escapeHtml(page.title)}</a></td><td>${formatDate(page.updatedAt)}</td><td>${page.revisionCount}</td><td><button class="quiet-action" data-rename-page="${escapeHtml(page.slug)}" type="button">Rename</button><button class="danger-action" data-delete-page="${escapeHtml(page.slug)}" type="button">Delete</button></td></tr>`).join('')}
      </tbody></table></div></section>`;
    document.title = 'Site overview · WikiNode';
  } catch (error) {
    workspace.innerHTML = `<section class="empty-state"><h1>Administrator access required</h1><p>${escapeHtml(error.message)}</p><a class="text-action" href="#/login">Log in</a></section>`;
  }
}

async function showAccounts() {
  try {
    const accounts = await requestJson('/api/accounts');
    workspace.innerHTML = `<section class="listing-view"><div class="article-tabs"><div class="page-tabs"><a href="#/overview">Site overview</a><span class="selected">Accounts</span></div></div>
      <h1>Accounts</h1><p class="listing-intro">Create editor accounts or additional administrators.</p>
      <form class="account-create-form" id="account-form"><label for="new-username">Username</label><input id="new-username" name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]+" autocomplete="off" required>
        <label for="new-password">Temporary password</label><input id="new-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required>
        <label for="new-role">Role</label><select id="new-role" name="role"><option value="editor">Editor</option><option value="admin">Administrator</option></select>
        <button class="text-action" type="submit">Add account</button><div class="form-message" id="account-message" role="status"></div></form>
      <div class="overview-table-wrap"><table class="overview-table"><thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead><tbody>
      ${accounts.map((account) => `<tr><td>${escapeHtml(account.username)}</td><td>${account.role === 'admin' ? 'Administrator' : 'Editor'}</td><td>${formatDate(account.createdAt)}</td><td><button class="danger-action" data-delete-account="${escapeHtml(account.username)}" type="button">Delete</button></td></tr>`).join('')}
      </tbody></table></div></section>`;
    document.title = 'Accounts · WikiNode';
    document.querySelector('#account-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const message = document.querySelector('#account-message');
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await requestJson('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: form.get('username'), password: form.get('password'), role: form.get('role') })
        });
        await showAccounts();
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
      }
    });
  } catch (error) {
    workspace.innerHTML = `<section class="empty-state"><h1>Administrator access required</h1><p>${escapeHtml(error.message)}</p><a class="text-action" href="#/login">Log in</a></section>`;
  }
}

async function refreshSidebar() {
  try {
    const pages = await requestJson('/api/pages');
    const recent = pages.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 5);
    document.querySelector('#sidebar-recent').innerHTML = recent.map((page) =>
      `<a href="#/wiki/${encodeURIComponent(page.slug)}">${escapeHtml(page.title)}</a>`
    ).join('');
  } catch {
    document.querySelector('#sidebar-recent').innerHTML = '<span class="sidebar-empty">Pages will appear here</span>';
  }
}

function pageHeader(page, label) {
  return `<div class="article-tabs"><div class="page-tabs"><a class="selected" href="#/wiki/${encodeURIComponent(page.slug)}">Article</a></div>
      <div class="page-actions"><a class="selected" href="#/wiki/${encodeURIComponent(page.slug)}">Read</a><a href="#/edit/${encodeURIComponent(page.slug)}">Edit</a><a href="#/history/${encodeURIComponent(page.slug)}">View history</a></div></div>
    <div class="article-heading"><h1>${escapeHtml(page.title)}</h1><span class="article-language">English</span></div>`;
}

async function showPage(slug) {
  workspace.innerHTML = '<div class="loading-state">Opening the archive<span>.</span><span>.</span><span>.</span></div>';
  try {
    const page = await requestJson(`/api/pages/${encodeURIComponent(slug)}`);
    workspace.innerHTML = `<article class="article-view">${pageHeader(page, 'ARTICLE')}
      <div class="article-meta"><span>From WikiNode, the free encyclopedia</span></div>
      <div class="article-body">${page.html}</div>
      <div class="article-bottom"><span>Last edited ${formatDate(page.updatedAt)} · ${page.revisionCount} ${page.revisionCount === 1 ? 'revision' : 'revisions'}</span><a href="#/history/${encodeURIComponent(page.slug)}">View edit history</a></div>
      </article>`;
    document.title = `${page.title} · WikiNode`;
  } catch (error) {
    workspace.innerHTML = `<section class="empty-state"><div class="empty-icon">＋</div><div class="eyebrow">PAGE NOT FOUND</div><h1>This page is still unwritten.</h1><p>${escapeHtml(error.message)} Create it and add the first piece of knowledge.</p><button class="text-action" data-create-title="${escapeHtml(slug.replace(/-/g, ' '))}">Create this page <span aria-hidden="true">→</span></button></section>`;
    document.title = 'Page not found · WikiNode';
  }
}

async function showEditor(slug) {
  let page = null;
  if (slug) {
    try {
      page = await requestJson(`/api/pages/${encodeURIComponent(slug)}`);
    } catch (error) {
      workspace.innerHTML = `<section class="empty-state"><div class="eyebrow">PAGE NOT FOUND</div><h1>Nothing to edit yet.</h1><p>${escapeHtml(error.message)}</p><a class="text-action" href="#/edit/new">Create a new page <span aria-hidden="true">→</span></a></section>`;
      return;
    }
  }

  workspace.innerHTML = `<section class="editor-view"><div class="article-tabs"><div class="page-tabs"><a href="#/wiki/${page ? encodeURIComponent(page.slug) : 'home'}">Article</a><span class="selected">${page ? 'Edit' : 'Create'}</span></div></div>
    <h1>${page ? `Editing ${escapeHtml(page.title)}` : 'Create a page'}</h1>
    <form class="editor-form" id="editor-form">
      <label for="page-title">Page title</label><input id="page-title" name="title" maxlength="120" required value="${page ? escapeHtml(page.title) : ''}" ${page ? 'readonly' : ''} placeholder="For example: History of bicycles">
      <div class="markdown-workbench">
        <section class="markdown-pane"><div class="pane-heading"><label for="page-editor">Write</label><span>Markdown</span></div>
          <textarea id="page-editor" name="content" maxlength="100000" required spellcheck="true" placeholder="# A page title\n\nWrite your article here...">${page ? escapeHtml(page.content) : ''}</textarea>
        </section>
        <section class="preview-pane"><div class="pane-heading"><span>Preview</span><span class="preview-status" id="preview-status">Ready</span></div>
          <div class="markdown-preview" id="markdown-preview">${page ? page.html : '<p class="preview-empty">Your preview will appear here.</p>'}</div>
        </section>
      </div>
      <label for="edit-summary">Edit summary <span>Optional</span></label><input id="edit-summary" name="summary" maxlength="200" placeholder="What changed in this edit?">
      <div class="editor-actions"><a class="quiet-action" href="${page ? `#/wiki/${encodeURIComponent(page.slug)}` : '#/wiki/home'}">Cancel</a><button class="text-action" type="submit">${page ? 'Publish changes' : 'Create page'}</button></div>
      <div class="form-message" id="form-message" role="status"></div>
    </form></section>`;
  document.title = `${page ? 'Edit' : 'New page'} · WikiNode`;
  const editor = document.querySelector('#page-editor');
  const preview = document.querySelector('#markdown-preview');
  const previewStatus = document.querySelector('#preview-status');
  let previewTimer;
  editor.addEventListener('input', () => {
    clearTimeout(previewTimer);
    const content = editor.value;
    previewStatus.textContent = 'Updating…';
    previewTimer = setTimeout(async () => {
      try {
        const result = await requestJson('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        if (editor.value === content) {
          preview.innerHTML = result.html || '<p class="preview-empty">Your preview will appear here.</p>';
          previewStatus.textContent = 'Ready';
        }
      } catch {
        previewStatus.textContent = 'Preview unavailable';
      }
    }, 180);
  });
  document.querySelector('#editor-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const message = document.querySelector('#form-message');
    const content = editor.value;
    if (!content.trim()) {
      message.textContent = 'Please write a little article text before publishing.';
      return;
    }
    button.disabled = true;
    message.textContent = 'Publishing…';
    try {
      const result = await requestJson(page ? `/api/pages/${encodeURIComponent(page.slug)}` : '/api/pages', {
        method: page ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.get('title'), content, summary: form.get('summary') })
      });
      await refreshSidebar();
      location.hash = `#/wiki/${encodeURIComponent(result.slug)}`;
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });
}

async function showHistory(slug) {
  try {
    const [page, revisions] = await Promise.all([
      requestJson(`/api/pages/${encodeURIComponent(slug)}`),
      requestJson(`/api/pages/${encodeURIComponent(slug)}/history`)
    ]);
    workspace.innerHTML = `<section class="listing-view"><div class="breadcrumbs"><a href="#/wiki/home">Main page</a><span>/</span><a href="#/wiki/${encodeURIComponent(slug)}">${escapeHtml(page.title)}</a><span>/</span><span>History</span></div>
      <div class="eyebrow">ARTICLE RECORD</div><h1>Revision history</h1><p class="listing-intro">Every published version of <a href="#/wiki/${encodeURIComponent(slug)}">${escapeHtml(page.title)}</a>.</p>
      <div class="revision-list">${revisions.map((revision, index) => `<div class="revision-row"><div class="revision-number">${String(revision.id).padStart(2, '0')}</div><div class="revision-details"><strong>${escapeHtml(revision.summary || 'Updated page')}</strong><span>${escapeHtml(revision.author)} · ${formatDate(revision.createdAt, true)}</span></div>${index === 0 ? '<span class="current-badge">CURRENT</span>' : ''}</div>`).join('')}</div></section>`;
    document.title = `History: ${page.title} · WikiNode`;
  } catch (error) {
    workspace.innerHTML = `<section class="empty-state"><div class="eyebrow">HISTORY UNAVAILABLE</div><h1>We couldn't find that article.</h1><p>${escapeHtml(error.message)}</p><a class="text-action" href="#/wiki/home">Return to the main page</a></section>`;
  }
}

async function showAllPages() {
  try {
    const pages = await requestJson('/api/pages');
    workspace.innerHTML = `<section class="listing-view"><div class="breadcrumbs"><a href="#/wiki/home">Main page</a><span>/</span><span>All pages</span></div><div class="eyebrow">THE KNOWLEDGE INDEX</div><h1>All pages</h1><p class="listing-intro">${pages.length} ${pages.length === 1 ? 'article' : 'articles'} in this wiki.</p>
      <div class="page-index">${pages.map((page) => `<a class="page-index-row" href="#/wiki/${encodeURIComponent(page.slug)}"><span>${escapeHtml(page.title)}</span><span>${formatDate(page.updatedAt)} <b aria-hidden="true">↗</b></span></a>`).join('')}</div></section>`;
    document.title = 'All pages · WikiNode';
  } catch (error) {
    workspace.innerHTML = `<section class="empty-state"><h1>Unable to load pages</h1><p>${escapeHtml(error.message)}</p></section>`;
  }
}

async function showRecentChanges() {
  try {
    const changes = await requestJson('/api/recent');
    workspace.innerHTML = `<section class="listing-view"><div class="breadcrumbs"><a href="#/wiki/home">Main page</a><span>/</span><span>Recent changes</span></div><div class="eyebrow">A LIVING ARCHIVE</div><h1>Recent changes</h1><p class="listing-intro">The latest contributions from this wiki's editors.</p>
      <div class="revision-list">${changes.length ? changes.map((change) => `<a class="revision-row revision-link" href="#/wiki/${encodeURIComponent(change.slug)}"><div class="revision-date">${formatDate(change.createdAt, true)}</div><div class="revision-details"><strong>${escapeHtml(change.title)}</strong><span>${escapeHtml(change.summary || 'Updated page')} · ${escapeHtml(change.author)}</span></div><span class="row-arrow" aria-hidden="true">↗</span></a>`).join('') : '<div class="no-results">No edits yet. Every new page will appear here.</div>'}</div></section>`;
    document.title = 'Recent changes · WikiNode';
  } catch (error) {
    workspace.innerHTML = `<section class="empty-state"><h1>Unable to load changes</h1><p>${escapeHtml(error.message)}</p></section>`;
  }
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (!query) {
    searchResults.hidden = true;
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const pages = await requestJson(`/api/pages?q=${encodeURIComponent(query)}`);
      searchResults.innerHTML = pages.length
        ? pages.map((page) => `<a href="#/wiki/${encodeURIComponent(page.slug)}"><span class="result-mark">↗</span><span>${escapeHtml(page.title)}</span></a>`).join('')
        : `<div class="no-results">No titles match “${escapeHtml(query)}”.</div>`;
      searchResults.hidden = false;
    } catch {
      searchResults.hidden = true;
    }
  }, 140);
});

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  const pages = await requestJson(`/api/pages?q=${encodeURIComponent(query)}`);
  searchResults.hidden = true;
  if (pages.length) location.hash = `#/wiki/${encodeURIComponent(pages[0].slug)}`;
  else location.hash = `#/wiki/${encodeURIComponent(query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}`;
  searchInput.blur();
});

document.querySelector('#new-page').addEventListener('click', () => { location.hash = '#/edit/new'; });
document.querySelector('#home-link').addEventListener('click', () => { searchInput.value = ''; searchResults.hidden = true; });
document.addEventListener('click', async (event) => {
  if (!event.target.closest('.search-form')) searchResults.hidden = true;
  const createButton = event.target.closest('[data-create-title]');
  if (createButton) {
    location.hash = '#/edit/new';
    setTimeout(() => { document.querySelector('#page-title').value = createButton.dataset.createTitle; }, 0);
  }

  if (event.target.closest('#logout-button')) {
    await fetch('/api/auth/logout', { method: 'POST' });
    await refreshAuthUi();
    location.hash = '#/login';
    return;
  }

  const renameButton = event.target.closest('[data-rename-page]');
  if (renameButton) {
    const title = window.prompt('New page title:');
    if (!title?.trim()) return;
    try {
      const result = await requestJson(`/api/pages/${encodeURIComponent(renameButton.dataset.renamePage)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      await Promise.all([showOverview(), refreshSidebar()]);
      if (location.hash === `#/wiki/${encodeURIComponent(renameButton.dataset.renamePage)}`) {
        location.hash = `#/wiki/${encodeURIComponent(result.slug)}`;
      }
    } catch (error) {
      window.alert(error.message);
    }
    return;
  }

  const deletePageButton = event.target.closest('[data-delete-page]');
  if (deletePageButton) {
    if (!window.confirm(`Delete “${deletePageButton.closest('tr').querySelector('td').textContent}”? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(deletePageButton.dataset.deletePage)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to delete page.');
      await Promise.all([showOverview(), refreshSidebar()]);
    } catch (error) {
      window.alert(error.message);
    }
    return;
  }

  const deleteAccountButton = event.target.closest('[data-delete-account]');
  if (deleteAccountButton) {
    if (!window.confirm(`Delete account “${deleteAccountButton.dataset.deleteAccount}”?`)) return;
    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(deleteAccountButton.dataset.deleteAccount)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to delete account.');
      await showAccounts();
    } catch (error) {
      window.alert(error.message);
    }
  }
});
window.addEventListener('hashchange', route);
refreshSidebar();
refreshAuthUi();
route();