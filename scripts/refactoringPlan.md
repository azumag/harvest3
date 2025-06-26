# Code Similarity Analysis & Refactoring Plan

Based on similarity-ts analysis, the following refactoring opportunities have been identified:

## 🚨 High Priority (95%+ Similarity)

### 1. Test Script Templates (95.00% - 95.91% similarity)
**Files:**
- `testAnomalyDetectorSystem.js` ↔ `testPhase27Systems.js` (95.00%)
- `testMarketPriceTracker.js` ↔ `testPendingOrderLimitManager.js` (95.91%)
- `testOrderValidation.js` ↔ `testPendingOrderLimitManager.js` (95.91%)
- `testMarketPriceTracker.js` ↔ `testOrderValidation.js` (95.91%)

**Common Pattern:**
```javascript
// Common structure across all test scripts:
1. Header banner with ASCII art
2. Test result tracking object
3. Phase-based testing structure
4. Try-catch error handling
5. Summary reporting
```

**Refactoring Solution:**
Create `src/common/testRunner.js` utility:
```javascript
class TestRunner {
  constructor(testName, phases) { /* ... */ }
  createBanner(title) { /* ... */ }
  runPhase(phaseName, tests) { /* ... */ }
  generateSummary() { /* ... */ }
}
```

### 2. System Reset Functions (92.85% similarity)
**Files:**
- `fullSystemReset.js:cancelAllOpenOrders` ↔ `fullSystemReset.js:closeAllPositions`

**Refactoring Solution:**
Extract common order/position management patterns into utilities.

## 🔶 Medium Priority (80-95% Similarity)

### 3. Position Analysis Functions (86.28% - 86.55% similarity)
**Files:**
- `checkPositionConsistency.js:analyzeConsistency` ↔ `fixPositionInconsistencies.js:analyzeInconsistency`
- `checkPositionConsistency.js:analyzeConsistency` ↔ `fixPositionInconsistencies.js:generateFixProposals`

**Common Pattern:**
- Position data collection
- Inconsistency detection logic
- Report generation

**Refactoring Solution:**
Create `src/common/positionAnalyzer.js`:
```javascript
class PositionAnalyzer {
  async analyzeInconsistencies(exchanges) { /* ... */ }
  generateReport(inconsistencies) { /* ... */ }
  proposeFixActions(analysis) { /* ... */ }
}
```

### 4. Argument Parsing (80.42% similarity)
**Files:**
- `cleanupOldPositions.js:parseArguments` ↔ `comprehensivePendingOrderManager.js:main`

**Refactoring Solution:**
Create `src/common/cliUtils.js`:
```javascript
function parseScriptArguments(schema) { /* ... */ }
function validateArguments(args, schema) { /* ... */ }
```

## 📋 Refactoring Implementation Plan

### Phase 1: Test Framework Unification
1. Create `src/common/testRunner.js`
2. Migrate test scripts to use TestRunner
3. Remove duplicate test infrastructure

### Phase 2: Position Management Utilities
1. Create `src/common/positionAnalyzer.js`
2. Extract common position analysis logic
3. Update dependent scripts

### Phase 3: CLI Utilities
1. Create `src/common/cliUtils.js`
2. Standardize argument parsing across scripts
3. Add validation and help text generation

### Phase 4: System Management Utilities
1. Extract common patterns from system reset functions
2. Create reusable order/position management utilities

## 🎯 Expected Benefits

1. **Code Reduction:** ~30-40% reduction in duplicate code
2. **Maintainability:** Centralized common functionality
3. **Consistency:** Standardized patterns across scripts
4. **Testing:** Easier to test centralized utilities
5. **Documentation:** Single source of truth for common operations

## 📊 Impact Analysis

**Files to be Modified:** 9-12 files
**New Utility Files:** 3-4 files
**Estimated Time Reduction:** 2-3 hours for future similar script development
**Risk Level:** Low (utilities are additive, original functions remain as fallback)