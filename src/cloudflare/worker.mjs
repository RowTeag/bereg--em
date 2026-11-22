import { DurableObject } from 'cloudflare:workers';
import { createServer } from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire('/worker.mjs');
const fs = require('node:fs');

const DATA_DIRECTORY = '/tmp/bereg-crm-data';
function portForVersion(id) {
  if (!id) return 8765;
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return 1024 + ((hash >>> 0) % 60000);
}

export class BeregRuntime extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.dataDirectory = env.APP_DATA_DIR || DATA_DIRECTORY;
    this.migrationSecret = env.BEREG_MIGRATION_SECRET || '';
    this.ctx = ctx;
    this.serverPort = portForVersion(env.CF_VERSION_METADATA?.id);
    this.fsReady = ctx.blockConcurrencyWhile(async () => {
      const { installDurableFilesystem } = await import('./durable-fs.js');
      this.files = installDurableFilesystem(fs, ctx.storage.sql, this.dataDirectory);
    });
    this.ready = null;
  }

  async ensureApp() {
    if (!this.ready) this.ready = (async () => {
      await this.fsReady;

      for (const [key, value] of Object.entries(this.env)) {
        if (typeof value === 'string') process.env[key] = value;
      }
      globalThis.__BEREG_TRANSLATION_AI = this.env.AI || null;

      // iconv-lite 0.4 ships a browser build without its Node stream extension;
      // its runtime check must match that build while Express is initialized.
      const nodeVersion = process.versions?.node;
      if (nodeVersion) Object.defineProperty(process.versions, 'node', { value: undefined, configurable: true });
      let createApp;
      try { ({ createApp } = await import('../server.js')); }
      finally {
        if (nodeVersion) Object.defineProperty(process.versions, 'node', { value: nodeVersion, configurable: true });
      }
      const app = createApp({ worker: true, appDataDirectory: this.dataDirectory });
      this.caseworkTick = app.locals.beregCaseworkTick;
      this.syncClients = app.locals?.beregSyncClients;
      this.flushSupportQueue = app.locals?.beregFlushSupportQueue;
      const server = createServer(app);
      await new Promise((resolve, reject) => {
        const onListening = () => { cleanup(); resolve(); };
        const onError = error => {
          cleanup();
          // Node HTTP servers can outlive an evicted Durable Object instance.
          // In that case this routing key is already served by the surviving server.
          if (error.code === 'EADDRINUSE') resolve();
          else reject(error);
        };
        const cleanup = () => {
          server.off('listening', onListening);
          server.off('error', onError);
        };
        server.once('listening', onListening);
        server.once('error', onError);
        try {
          server.listen(this.serverPort);
        } catch (error) {
          cleanup();
          if (error.code === 'EADDRINUSE') resolve();
          else reject(error);
        }
      });
      await this.ctx.storage.setAlarm(Date.now() + 30000);
    })();
    await this.ready;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__codex_migrate') {
      if (!this.migrationSecret || request.headers.get('x-bereg-migration-key') !== this.migrationSecret) {
        return new Response('Not found', { status: 404 });
      }
      await this.fsReady;
      try {
        const payload = await request.json();
        const relative = String(payload.path || '');
        if (!(relative.startsWith('.private/') || relative.startsWith('generated/')) || relative.split('/').some(part => !part || part === '.' || part === '..')) {
          return Response.json({ error: 'Invalid migration path.' }, { status: 400 });
        }
        const index = Number(payload.index);
        if (!Number.isSafeInteger(index) || index < 0 || typeof payload.data !== 'string' || payload.data.length > 360000) {
          return Response.json({ error: 'Invalid migration chunk.' }, { status: 400 });
        }
        const bytes = Buffer.from(payload.data, 'base64');
        if (bytes.length > 270000) return Response.json({ error: 'Migration chunk is too large.' }, { status: 413 });
        const target = path.join(this.dataDirectory, relative);
        this.files.writeMigrationChunk(target, index, bytes);
        return Response.json({ ok: true, path: relative, index });
      } catch (error) {
        return Response.json({ error: error.message || 'Migration failed.' }, { status: 400 });
      }
    }
    await this.fsReady;
    if (this.files.readBuffer(path.join(this.dataDirectory, '.private/panel-users.json')) === null) {
      return Response.json({ error: 'CRM data migration is not complete yet.' }, { status: 503 });
    }
    await this.ensureApp();
    return handleAsNodeRequest(this.serverPort, request);
  }

  async alarm() {
    try {
      await this.ensureApp();
      await this.caseworkTick?.();
      await this.syncClients?.();
      await this.flushSupportQueue?.();
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 30000);
    }
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const dynamic = pathname.startsWith('/api/')
      || pathname.startsWith('/generated/')
      || pathname.startsWith('/webhooks/')
      || pathname === '/__codex_migrate'
      || pathname === '/healthz';

    if (!dynamic) {
      const htmlPath = pathname === '/login' ? '/login.html' : ['/mini','/mini-crm'].includes(pathname) ? '/mini.html' : pathname === '/crm-offer' ? '/sales.html' : pathname === '/crm-offer/privacy' ? '/sales-privacy.html' : pathname === '/crm-offer-admin' ? '/sales-admin.html' : pathname === '/' ? '/index.html' : null;
      if (htmlPath) {
        const response = await env.ASSETS.fetch(new Request(new URL(htmlPath, request.url), request));
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store, max-age=0');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      return env.ASSETS.fetch(request);
    }

    const id = env.APP.idFromName('bereg-crm-singleton');
    return env.APP.get(id).fetch(request);
  }
};
