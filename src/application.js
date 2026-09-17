import { Config } from './config.js';
import { AuditClient } from '@atc-web/service-core/audit';
import { Lifecycle } from '@atc-web/service-core/lifecycle';
import { Database } from './db.js';
import { SearchService } from './domain/search-service.js';
import { SearchApi } from './http/search-api.js';
import { DocumentStore } from './store/document-store.js';
import { IndexStore } from './store/index-store.js';

/** Composition root: wires configuration, storage, domain and HTTP, and owns the process lifecycle. */
export class Application {
  /** @param {Config} config */
  constructor(config) {
    this.config = config;
    this.audit = new AuditClient({ target: config.audit });
    this.db = new Database(config.dbPath, { backupDir: config.dbBackupDir });
    this.indexes = new IndexStore(this.db);
    this.documents = new DocumentStore(this.db);
    this.service = new SearchService({ db: this.db, indexes: this.indexes, documents: this.documents, options: config });
    /** @type {import('fastify').FastifyInstance|null} */
    this.app = null;
    /** @type {(reason: string) => Promise<void>} */
    this.shutdown = async () => {};
  }

  /** Build from `process.env`; exits with a readable message on bad configuration. */
  static fromEnv() {
    try {
      return new Application(Config.fromEnv());
    } catch (err) {
      if (err instanceof Error && err.name === 'ConfigError') {
        console.error(`configuration error: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  }

  async start() {
    const { config } = this;
    const api = new SearchApi({ config, audit: this.audit, service: this.service, indexes: this.indexes, documents: this.documents, db: this.db });
    const app = await api.build();
    this.app = app;
    const { shutdown } = Lifecycle.install({
      forceExitMs: 30_000,
      log: app.log,
      steps: [
        () => this.app?.close(),
        () => this.audit.close(),
        () => this.db.close(),
      ],
    });
    this.shutdown = shutdown;
    this.audit.logger = app.log;
    this.audit.start();
    await app.listen({ port: config.port, host: config.host });
    app.log.info({ tls: config.tls !== null, indexes: this.indexes.all().length, documents: this.documents.total() }, config.tls ? 'serving HTTPS' : 'serving plain HTTP, terminate TLS at a reverse proxy');
    if (process.send) process.send('ready'); // PM2 wait_ready
  }
}
