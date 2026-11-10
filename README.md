# WikiNode

A small, self-hosted wiki built with Node.js. Write articles in Markdown, link pages with `[[Page title]]`, and keep a revision history for every edit.

## Run locally

Requires Node.js 18 or newer.

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Use `npm run dev` to restart the server automatically during development, or set `PORT` to choose another port.

## Content and backups

The first launch creates a welcome page and an about page. The `data/` directory stores pages and revisions (`wiki.json`), account password hashes (`users.json`), and the signing key for login sessions (`session-key`). Back up the entire directory and keep it private. It is intentionally excluded from version control. Set `WIKINODE_DATA_DIR` to use another persistent directory.

## Accounts and administration

On first launch, select **Set up this wiki** and create the administrator account. Use a unique password of at least 12 characters. After setup, administrators can open **Site overview** to create, rename, and delete pages, and use **Accounts** to add editor or administrator accounts. Signed-in editors can edit existing pages. Passwords are hashed with Node.js `scrypt`; account and session files receive owner-only permissions on POSIX systems.

## Scope

WikiNode is a lightweight starting point for a community wiki, not a feature-for-feature MediaWiki replacement. It includes page editing, Markdown, internal links, title search, an all-pages index, recent changes, revision history, accounts, and administrator tools. Article reading is public; editing and administration require an account.

## Deployment limits

This release uses JSON files rather than a transactional database. Run one Node.js process with a persistent data directory; multiple workers or replicas can overwrite each other's updates. Login throttling is in memory and is also per process. There is no email verification, password reset, public registration, or account recovery. Keep a tested backup of `data/` before upgrading or deploying.

For an HTTPS deployment behind one trusted reverse proxy, set `NODE_ENV=production` and `TRUST_PROXY=1` so secure session cookies work. Set `TRUST_PROXY` to the correct trusted hop count for your topology; do not trust forwarded headers from untrusted clients. For example:

```sh
NODE_ENV=production TRUST_PROXY=1 npm start
```

Do not expose the app over plain HTTP on a public network. Run the automated checks with `npm test`; run `npm audit` before each release.

## License

MIT
