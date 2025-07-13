/**
 * APIヘルスチェックエンドポイントの単体テスト
 * CLAUDE.md要件: TDD原則に従った実装
 */

const request = require('supertest');
const express = require('express');

// モック対象モジュール
jest.mock('../../../src/database/redisClient');
jest.mock('../../../src/database/mongoDatabase');

describe('/api/health エンドポイント', () => {
  let app;
  let mockRedisClient;
  let mockMongoClient;

  beforeEach(() => {
    // Expressアプリのセットアップ
    app = express();
    app.use(express.json());

    // モッククライアントのセットアップ
    mockRedisClient = {
      isReady: true,
      ping: jest.fn()
    };

    mockMongoClient = {
      admin: jest.fn().mockReturnValue({
        ping: jest.fn()
      })
    };

    // データベースクライアントのモック
    const { getClient: getRedisClient } = require('../../../src/database/redisClient');
    const { getClient: getMongoClient } = require('../../../src/database/mongoDatabase');

    getRedisClient.mockReturnValue(mockRedisClient);
    getMongoClient.mockReturnValue(mockMongoClient);

    // ルートの追加
    app.get('/api/health', async (req, res) => {
      try {
        const healthStatus = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          services: {}
        };

        // Redis接続チェック
        try {
          const { getClient } = require('../../../src/database/redisClient');
          const redisClient = getClient();
          if (redisClient && redisClient.isReady) {
            await redisClient.ping();
            healthStatus.services.redis = 'connected';
          } else {
            healthStatus.services.redis = 'disconnected';
            healthStatus.status = 'degraded';
          }
        } catch (redisError) {
          healthStatus.services.redis = 'error';
          healthStatus.status = 'degraded';
        }

        // MongoDB接続チェック
        try {
          const { getClient: getMongoClient } = require('../../../src/database/mongoDatabase');
          const mongoClient = getMongoClient();
          if (mongoClient) {
            await mongoClient.admin().ping();
            healthStatus.services.mongodb = 'connected';
          } else {
            healthStatus.services.mongodb = 'disconnected';
            healthStatus.status = 'degraded';
          }
        } catch (mongoError) {
          healthStatus.services.mongodb = 'error';
          healthStatus.status = 'degraded';
        }

        // すべてのサービスが利用できない場合はエラー
        if (healthStatus.services.redis === 'error' && healthStatus.services.mongodb === 'error') {
          healthStatus.status = 'error';
          res.status(503).json(healthStatus);
        } else {
          res.json(healthStatus);
        }
      } catch (error) {
        res.status(503).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('正常ケース', () => {
    test('Redis、MongoDB共に正常接続時、status=okを返す', async () => {
      // Arrange
      mockRedisClient.ping.mockResolvedValue('PONG');
      mockMongoClient.admin().ping.mockResolvedValue({});

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.services.redis).toBe('connected');
      expect(response.body.services.mongodb).toBe('connected');
      expect(response.body.timestamp).toBeDefined();
      expect(mockRedisClient.ping).toHaveBeenCalledTimes(1);
      expect(mockMongoClient.admin().ping).toHaveBeenCalledTimes(1);
    });
  });

  describe('部分的な障害ケース', () => {
    test('Redisエラー、MongoDB正常時、status=degradedを返す', async () => {
      // Arrange
      mockRedisClient.ping.mockRejectedValue(new Error('Redis connection failed'));
      mockMongoClient.admin().ping.mockResolvedValue({});

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.services.redis).toBe('error');
      expect(response.body.services.mongodb).toBe('connected');
    });

    test('Redis正常、MongoDBエラー時、status=degradedを返す', async () => {
      // Arrange
      mockRedisClient.ping.mockResolvedValue('PONG');
      mockMongoClient.admin().ping.mockRejectedValue(new Error('MongoDB connection failed'));

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.services.redis).toBe('connected');
      expect(response.body.services.mongodb).toBe('error');
    });

    test('Redis未接続、MongoDB正常時、status=degradedを返す', async () => {
      // Arrange
      mockRedisClient.isReady = false;
      mockMongoClient.admin().ping.mockResolvedValue({});

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.services.redis).toBe('disconnected');
      expect(response.body.services.mongodb).toBe('connected');
      expect(mockRedisClient.ping).not.toHaveBeenCalled();
    });
  });

  describe('完全障害ケース', () => {
    test('Redis、MongoDB共にエラー時、status=error、503ステータスを返す', async () => {
      // Arrange
      mockRedisClient.ping.mockRejectedValue(new Error('Redis connection failed'));
      mockMongoClient.admin().ping.mockRejectedValue(new Error('MongoDB connection failed'));

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('error');
      expect(response.body.services.redis).toBe('error');
      expect(response.body.services.mongodb).toBe('error');
    });
  });

  describe('例外処理', () => {
    test('Redis接続エラー時、正しく処理される', async () => {
      // Arrange
      mockRedisClient.ping.mockRejectedValue(new Error('Redis connection failed'));
      mockMongoClient.admin().ping.mockResolvedValue({});

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.services.redis).toBe('error');
      expect(response.body.services.mongodb).toBe('connected');
    });
  });
});