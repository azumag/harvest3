/**
 * APIヘルスチェックエンドポイントの単体テスト
 * CLAUDE.md要件: TDD原則に従った実装
 */

const request = require('supertest');
const express = require('express');

// モック対象モジュール
jest.mock('../../../src/database/redisClient');
jest.mock('../../../src/database/mongoDatabase');
jest.mock('../../../src/utils/healthCheck');

describe('/api/health エンドポイント', () => {
  let app;
  let mockPerformHealthCheck;

  beforeEach(() => {
    // Expressアプリのセットアップ
    app = express();
    app.use(express.json());

    // ヘルスチェック関数のモック
    const { performHealthCheck } = require('../../../src/utils/healthCheck');
    mockPerformHealthCheck = performHealthCheck;

    // ルートの追加
    app.get('/api/health', async (req, res) => {
      try {
        const healthStatus = await mockPerformHealthCheck();

        if (healthStatus.status === 'error') {
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
      mockPerformHealthCheck.mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          redis: 'connected',
          mongodb: 'connected'
        }
      });

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.services.redis).toBe('connected');
      expect(response.body.services.mongodb).toBe('connected');
      expect(response.body.timestamp).toBeDefined();
      expect(mockPerformHealthCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe('部分的な障害ケース', () => {
    test('Redisエラー、MongoDB正常時、status=degradedを返す', async () => {
      // Arrange
      mockPerformHealthCheck.mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          redis: 'error',
          mongodb: 'connected',
          redisError: 'Redis connection failed'
        }
      });

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
      mockPerformHealthCheck.mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          redis: 'connected',
          mongodb: 'error',
          mongoError: 'MongoDB connection failed'
        }
      });

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
      mockPerformHealthCheck.mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          redis: 'disconnected',
          mongodb: 'connected'
        }
      });

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.services.redis).toBe('disconnected');
      expect(response.body.services.mongodb).toBe('connected');
    });
  });

  describe('完全障害ケース', () => {
    test('Redis、MongoDB共にエラー時、status=error、503ステータスを返す', async () => {
      // Arrange
      mockPerformHealthCheck.mockResolvedValue({
        status: 'error',
        timestamp: new Date().toISOString(),
        services: {
          redis: 'error',
          mongodb: 'error',
          redisError: 'Redis connection failed',
          mongoError: 'MongoDB connection failed'
        }
      });

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
    test('ヘルスチェック関数例外時、503エラーを返す', async () => {
      // Arrange
      mockPerformHealthCheck.mockRejectedValue(new Error('Health check failed'));

      // Act
      const response = await request(app).get('/api/health');

      // Assert
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('error');
      expect(response.body.error).toBe('Health check failed');
      expect(response.body.timestamp).toBeDefined();
    });
  });
});