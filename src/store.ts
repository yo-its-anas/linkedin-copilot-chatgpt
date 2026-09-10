import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

interface StoredRow { payload: Uint8Array; expires_at: number | null }

/** Durable, encrypted single-process storage. Times are Unix milliseconds. */
export class Store {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;

  constructor(databasePath: string, encryptionKey: string | Buffer) {
    this.key = Buffer.isBuffer(encryptionKey) ? Buffer.from(encryptionKey) : Buffer.from(encryptionKey, 'base64');
    if (this.key.length !== 32) throw new Error('Storage encryption requires a 32-byte key.');
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS records (
        namespace TEXT NOT NULL,
        record_key TEXT NOT NULL,
        payload BLOB NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY(namespace, record_key)
      );
      CREATE INDEX IF NOT EXISTS records_expiration ON records(expires_at);
    `);
    if (databasePath !== ':memory:' && process.platform !== 'win32') chmodSync(databasePath, 0o600);
    // Detect an incorrect key immediately rather than silently opening an empty logical store.
    this.db.exec('CREATE TABLE IF NOT EXISTS key_check (id INTEGER PRIMARY KEY CHECK (id = 1), payload BLOB NOT NULL)');
    const marker = this.db.prepare('SELECT payload FROM key_check WHERE id = 1').get() as { payload: Uint8Array } | undefined;
    try {
      if (marker) this.decrypt(marker.payload, 'key-check');
      else this.db.prepare('INSERT INTO key_check(id, payload) VALUES (1, ?)').run(this.encrypt('linkedin-agent-v1', 'key-check'));
    } catch {
      this.db.close();
      throw new Error('Cannot decrypt database. Check ENCRYPTION_KEY; do not overwrite the database.');
    }
  }

  private address(namespace: string, key: string): [string, string] {
    const hash = (domain: string, value: string) => createHmac('sha256', this.key).update(domain).update('\0').update(value).digest('hex');
    return [hash('namespace', namespace), hash(`key:${namespace}`, key)];
  }

  private encrypt(value: unknown, aad: string): Buffer {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('Only JSON values can be stored.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  private decrypt<T>(value: Uint8Array, aad: string): T {
    const payload = Buffer.from(value);
    const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(payload.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')) as T;
  }

  get<T>(namespace: string, key: string): T | undefined {
    const address = this.address(namespace, key);
    const row = this.db.prepare('SELECT payload, expires_at FROM records WHERE namespace = ? AND record_key = ?').get(...address) as unknown as StoredRow | undefined;
    if (!row) return undefined;
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      this.delete(namespace, key);
      return undefined;
    }
    return this.decrypt<T>(row.payload, address.join(':'));
  }

  set(namespace: string, key: string, value: unknown, expiresAt?: number): void {
    if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt < 0)) throw new TypeError('expiresAt must be Unix milliseconds.');
    const address = this.address(namespace, key);
    this.db.prepare('INSERT INTO records(namespace, record_key, payload, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(namespace, record_key) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at')
      .run(...address, this.encrypt(value, address.join(':')), expiresAt ?? null);
  }

  delete(namespace: string, key: string): void {
    this.db.prepare('DELETE FROM records WHERE namespace = ? AND record_key = ?').run(...this.address(namespace, key));
  }

  /** Consume a state/code/token under a transaction, preventing replay. */
  take<T>(namespace: string, key: string): T | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = this.get<T>(namespace, key);
      this.delete(namespace, key);
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  deleteNamespace(namespace: string): void {
    this.db.prepare('DELETE FROM records WHERE namespace = ?').run(this.address(namespace, '')[0]);
  }

  cleanup(): void { this.db.prepare('DELETE FROM records WHERE expires_at IS NOT NULL AND expires_at <= ?').run(Date.now()); }
  close(): void { this.db.close(); this.key.fill(0); }
}
