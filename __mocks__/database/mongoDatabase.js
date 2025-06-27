/**
 * Mock for database/mongoDatabase module
 * Prevents actual MongoDB connections during unit tests
 */

module.exports = {
  // Mock MongoDB connection functions
  connectDB: jest.fn().mockResolvedValue(true),
  closeDB: jest.fn().mockResolvedValue(true),
  
  // Mock collections
  ordersCollection: {
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 })
  },
  tradesCollection: {
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    })
  },
  signalsCollection: {
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    }),
    countDocuments: jest.fn().mockResolvedValue(0)
  },
  ohlcvCollection: {
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([])
    })
  },
  tickersCollection: {
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    findOne: jest.fn().mockResolvedValue(null)
  },
  positionsCollection: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([])
    })
  },
  
  // Mock all exported functions
  addOrderMongoDB: jest.fn().mockResolvedValue({ insertedId: 'mock-order-id' }),
  addOrdersBulk: jest.fn().mockResolvedValue({ insertedCount: 0 }),
  addTradeMongoDB: jest.fn().mockResolvedValue({ insertedId: 'mock-trade-id' }),
  addSignalMongoDB: jest.fn().mockResolvedValue({ insertedId: 'mock-signal-id' }),
  getOrderByOrderId: jest.fn().mockResolvedValue(null),
  updateOrderByOrderId: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  deleteOrderByOrderId: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  listOrders: jest.fn().mockResolvedValue([]),
  listTrades: jest.fn().mockResolvedValue([]),
  listSignals: jest.fn().mockResolvedValue([]),
  countSignals: jest.fn().mockResolvedValue(0),
  addOhlcvMongoDB: jest.fn().mockResolvedValue({ insertedId: 'mock-ohlcv-id' }),
  fetchHistoricalOHLCVData: jest.fn().mockResolvedValue([]),
  saveTickerMongoDB: jest.fn().mockResolvedValue({ insertedId: 'mock-ticker-id' }),
  fetchTickerFromMongoDB: jest.fn().mockResolvedValue(null),
  listFilledPositions: jest.fn().mockResolvedValue([]),
  ensureCollectionsExist: jest.fn().mockResolvedValue(true),
  createIndexes: jest.fn().mockResolvedValue(true),
  
  // Mock ObjectId
  ObjectId: jest.fn().mockImplementation((id) => ({ toString: () => id || 'mock-object-id' }))
};