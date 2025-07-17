/**
 * Minimal test to isolate the issue
 */

// Mock the function and test with it
jest.mock('../src/database/redisDatabase', () => ({
  getClient: jest.fn()
}));

jest.mock('../src/database/mongoDatabase', () => ({
  connectDB: jest.fn().mockResolvedValue(undefined),
  addTradeMongoDB: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/hft/utils/Logger', () => {
  return function Logger(context) {
    return {
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      context: context
    };
  };
});

const mockRedisClient = {
  eval: jest.fn()
};

const mockRedisDatabase = require('../src/database/redisDatabase');
mockRedisDatabase.getClient.mockReturnValue(mockRedisClient);

describe('Test actual manager function', () => {
  test('Should call actual manager function', async () => {
    console.log('Starting test');
    
    const manager = require('../src/database/manager');
    
    console.log('Manager loaded');
    console.log('releaseDistributedLock exists:', typeof manager.releaseDistributedLock);
    
    if (manager.releaseDistributedLock) {
      console.log('Function found, calling it');
      const result = await manager.releaseDistributedLock(null);
      console.log('Function result:', result);
      console.log('Function result type:', typeof result);
      
      expect(result).toBe(false);
    } else {
      console.log('Function not found');
      expect(true).toBe(false); // Force failure
    }
  });
});