import { describe, expect, it } from 'vitest';
import { parseConnectionUrl } from '../../src/parseUrl.js';

describe('parseConnectionUrl', () => {
  describe('postgres', () => {
    it('parses a full postgresql:// URL', () => {
      expect(parseConnectionUrl('postgresql://alice:secret@db.host:5433/mydb')).toEqual({
        dialect: 'postgres',
        host: 'db.host',
        port: 5433,
        user: 'alice',
        password: 'secret',
        database: 'mydb',
      });
    });

    it('accepts postgres:// alias', () => {
      const cfg = parseConnectionUrl('postgres://u:p@localhost/app');
      expect(cfg.dialect).toBe('postgres');
    });

    it('defaults port to 5432 when omitted', () => {
      const cfg = parseConnectionUrl('postgres://u:p@localhost/db');
      expect(cfg.dialect === 'postgres' && cfg.port).toBe(5432);
    });

    it('sets ssl: true for ?ssl=true', () => {
      const cfg = parseConnectionUrl('postgres://u:p@h/db?ssl=true');
      expect(cfg.dialect === 'postgres' && cfg.ssl).toBe(true);
    });

    it('sets ssl: true for ?sslmode=require', () => {
      const cfg = parseConnectionUrl('postgres://u:p@h/db?sslmode=require');
      expect(cfg.dialect === 'postgres' && cfg.ssl).toBe(true);
    });

    it('does not set ssl when sslmode=disable', () => {
      const cfg = parseConnectionUrl('postgres://u:p@h/db?sslmode=disable');
      expect(cfg.dialect).toBe('postgres');
      if (cfg.dialect === 'postgres') {
        expect(cfg.ssl).toBeUndefined();
      }
    });

    it('sets maxConnections from connection_limit', () => {
      const cfg = parseConnectionUrl('postgres://u:p@h/db?connection_limit=20');
      expect(cfg.dialect === 'postgres' && cfg.maxConnections).toBe(20);
    });

    it('sets maxConnections from pool_size', () => {
      const cfg = parseConnectionUrl('postgres://u:p@h/db?pool_size=5');
      expect(cfg.dialect === 'postgres' && cfg.maxConnections).toBe(5);
    });

    it('sets queryTimeoutMs from query_timeout', () => {
      const cfg = parseConnectionUrl('postgres://u:p@h/db?query_timeout=3000');
      expect(cfg.dialect === 'postgres' && cfg.queryTimeoutMs).toBe(3000);
    });

    it('decodes percent-encoded credentials', () => {
      const cfg = parseConnectionUrl('postgres://user%40org:p%40ss@h/db');
      expect(cfg.dialect === 'postgres' && cfg.user).toBe('user@org');
      expect(cfg.dialect === 'postgres' && cfg.password).toBe('p@ss');
    });
  });

  describe('mysql', () => {
    it('parses a mysql:// URL', () => {
      expect(parseConnectionUrl('mysql://root:pw@127.0.0.1:3307/shop')).toEqual({
        dialect: 'mysql',
        host: '127.0.0.1',
        port: 3307,
        user: 'root',
        password: 'pw',
        database: 'shop',
      });
    });

    it('defaults port to 3306 when omitted', () => {
      const cfg = parseConnectionUrl('mysql://u:p@localhost/db');
      expect(cfg.dialect === 'mysql' && cfg.port).toBe(3306);
    });
  });

  describe('mongodb', () => {
    it('parses a mongodb:// URL', () => {
      expect(parseConnectionUrl('mongodb://user:pw@localhost:27017/app')).toEqual({
        dialect: 'mongodb',
        uri: 'mongodb://user:pw@localhost:27017/app',
        database: 'app',
      });
    });

    it('parses mongodb+srv:// URLs', () => {
      expect(parseConnectionUrl('mongodb+srv://u:p@cluster0.mongodb.net/mydb')).toEqual({
        dialect: 'mongodb',
        uri: 'mongodb+srv://u:p@cluster0.mongodb.net/mydb',
        database: 'mydb',
      });
    });
  });

  describe('errors', () => {
    it('throws TypeError for unsupported scheme', () => {
      expect(() => parseConnectionUrl('sqlite:///tmp/app.db')).toThrow(TypeError);
    });

    it('throws TypeError for a non-URL string', () => {
      expect(() => parseConnectionUrl('not a url')).toThrow(TypeError);
    });
  });
});
