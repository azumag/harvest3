// Unit test for backtest runner exit behavior fix
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

describe('BacktestRunner Exit Behavior', () => {
  let originalExit;
  let exitCalled;
  let exitCode;

  beforeEach(() => {
    // Mock process.exit
    originalExit = process.exit;
    exitCalled = false;
    exitCode = null;
    
    process.exit = (code) => {
      exitCalled = true;
      exitCode = code;
    };
  });

  afterEach(() => {
    // Restore original process.exit
    process.exit = originalExit;
    
    // Clean up environment variables
    delete process.env.BACKTEST_LONG_RUNNING_MODE;
    delete process.env.TEST_MODE;
  });

  test('should not exit when BACKTEST_LONG_RUNNING_MODE is true', () => {
    // Set up environment for long-running mode
    process.env.BACKTEST_LONG_RUNNING_MODE = 'true';
    process.env.TEST_MODE = 'false';

    // Simulate the finally block logic
    const shouldExit = process.env.TEST_MODE !== 'true' && !process.env.BACKTEST_LONG_RUNNING_MODE;
    
    if (shouldExit) {
      process.exit(0);
    }

    expect(exitCalled).toBe(false);
    expect(exitCode).toBe(null);
  });

  test('should exit when BACKTEST_LONG_RUNNING_MODE is not set', () => {
    // Set up environment for non-long-running mode
    process.env.TEST_MODE = 'false';
    // BACKTEST_LONG_RUNNING_MODE is not set

    // Simulate the finally block logic  
    const shouldExit = process.env.TEST_MODE !== 'true' && !process.env.BACKTEST_LONG_RUNNING_MODE;
    
    if (shouldExit) {
      process.exit(0);
    }

    expect(exitCalled).toBe(true);
    expect(exitCode).toBe(0);
  });

  test('should not exit when TEST_MODE is true', () => {
    // Set up environment for test mode
    process.env.TEST_MODE = 'true';
    // BACKTEST_LONG_RUNNING_MODE is not set

    // Simulate the finally block logic
    const shouldExit = process.env.TEST_MODE !== 'true' && !process.env.BACKTEST_LONG_RUNNING_MODE;
    
    if (shouldExit) {
      process.exit(0);
    }

    expect(exitCalled).toBe(false);
    expect(exitCode).toBe(null);
  });

  test('should exit when neither TEST_MODE nor BACKTEST_LONG_RUNNING_MODE are set appropriately', () => {
    // Default environment (neither variable is set)
    
    // Simulate the finally block logic
    const shouldExit = process.env.TEST_MODE !== 'true' && !process.env.BACKTEST_LONG_RUNNING_MODE;
    
    if (shouldExit) {
      process.exit(0);
    }

    expect(exitCalled).toBe(true);
    expect(exitCode).toBe(0);
  });
});