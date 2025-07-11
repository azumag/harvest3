/**
 * MongoDB接続設定のテスト
 * bufferMaxEntries削除とURLクエリパラメータ分離のテスト
 */

describe('MongoDB Connection Configuration', () => {
  describe('mongoOptions validation', () => {
    test('bufferMaxEntriesが含まれていないことを確認', () => {
      // mongoDatabase.jsから直接読み込みテスト
      const fs = require('fs');
      const path = require('path');
      const mongoDbPath = path.join(__dirname, '../../../src/database/mongoDatabase.js');
      const mongoDbSource = fs.readFileSync(mongoDbPath, 'utf8');

      // bufferMaxEntriesが使用されていないことを確認
      expect(mongoDbSource).not.toMatch(/bufferMaxEntries\s*:\s*\d+/);
      expect(mongoDbSource).toMatch(/bufferMaxEntries.*削除.*新しいドライバでは非対応/);
    });

    test('MONGO_URLがクエリパラメータを含まないことを確認', () => {
      // .envファイルのチェック
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '../../../.env');

      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const mongoUrlMatch = envContent.match(/MONGO_URL=(.+)/);

        if (mongoUrlMatch) {
          const mongoUrl = mongoUrlMatch[1];
          // クエリパラメータが含まれていないことを確認
          expect(mongoUrl).not.toMatch(/\?.*bufferMaxEntries/);
          expect(mongoUrl).not.toMatch(/\?.*serverSelectionTimeoutMS/);
          expect(mongoUrl).toMatch(/^mongodb:\/\/(mongodb|localhost):27017\/harvest3$/);
        }
      }
    });

    test('MongoDB接続オプションが適切に設定されていること', () => {
      // 実際のmongoOptionsオブジェクトをテスト（require使用は避ける）
      const expectedOptions = [
        'serverSelectionTimeoutMS',
        'connectTimeoutMS',
        'socketTimeoutMS',
        'maxPoolSize',
        'minPoolSize',
        'maxIdleTimeMS',
        'retryWrites',
        'heartbeatFrequencyMS',
        'compressors',
        'maxConnecting'
      ];

      const fs = require('fs');
      const path = require('path');
      const mongoDbPath = path.join(__dirname, '../../../src/database/mongoDatabase.js');
      const mongoDbSource = fs.readFileSync(mongoDbPath, 'utf8');

      // 各必要オプションが存在することを確認
      expectedOptions.forEach(option => {
        expect(mongoDbSource).toMatch(new RegExp(`${option}:\\s*(\\d+|true|\\[|SETTINGS\\.DATABASE\\.MONGODB\\.[A-Z_]+)`));
      });

      // 削除されたオプションが存在しないことを確認
      expect(mongoDbSource).not.toMatch(/bufferMaxEntries:\s*\d+/);
      expect(mongoDbSource).not.toMatch(/useNewUrlParser/);
      expect(mongoDbSource).not.toMatch(/useUnifiedTopology/);
    });
  });

  describe('MongoDB Driver Compatibility', () => {
    test('MongoClientが新しいオプションで作成できること', () => {
      const { MongoClient } = require('mongodb');

      const testOptions = {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 50,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
        retryWrites: true,
        heartbeatFrequencyMS: 10000,
        compressors: ['zlib'],
        maxConnecting: 10
      };

      // MongoClientインスタンスが作成できることを確認
      expect(() => {
        const client = new MongoClient('mongodb://localhost:27017/test', testOptions);
        client.close();
      }).not.toThrow();
    });
  });
});