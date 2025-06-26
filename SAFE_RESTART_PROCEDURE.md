# Safe System Restart Procedure

## ✅ Pre-Restart Status
All critical fixes have been implemented and tested:
- ✅ Missing function interfaces fixed (`checkSingleExchange`, `executeSelfHealing`)
- ✅ Position existence validation implemented
- ✅ Comprehensive order validation logging added
- ✅ Testing completed and validated

## 🚨 Current Safety State
- All strategies are currently DISABLED in config.js
- Enhanced validation prevents invalid position closes
- Comprehensive logging provides detailed error information
- Bitbank API confirmed working correctly

## 📋 Safe Restart Procedure

### Phase 1: Container Health Check
```bash
# 1. Check container status
docker ps

# 2. Check container logs for any errors
docker logs harvest3-bot-1 --tail 50
docker logs harvest3-mongodb-1 --tail 20  
docker logs harvest3-redis-1 --tail 20

# 3. Verify database connectivity
docker exec harvest3-redis-1 redis-cli ping
docker exec harvest3-mongodb-1 mongosh --eval "db.runCommand('ping')"
```

### Phase 2: Pre-Restart Validation
```bash
# 1. Run balance validation test
node test/testValidationSimple.js

# 2. Check current positions status
node test/testPositionValidation.js

# 3. Verify no stuck orders in pre_saved status
# (Check MongoDB for any orders with status: 'pre_saved')
```

### Phase 3: Gradual Strategy Re-enablement

#### Step 1: Enable ONE Strategy for Testing
**Recommended first strategy: MA (Moving Average)**
- Edit `src/config.js`
- Change only `MA.enabled: true` 
- Keep all other strategies disabled

```javascript
MA: {
  enabled: true,  // Only enable this one first
  // ... rest of config
}
```

#### Step 2: Test Single Strategy
```bash
# 1. Restart bot container
docker-compose restart bot

# 2. Monitor logs intensively
docker logs harvest3-bot-1 -f

# 3. Watch for validation messages:
#    - "📊 VALIDATION START"
#    - "💰 BALANCE DETAILS" 
#    - "✅ VALIDATION PASSED" or "❌ VALIDATION FAILED"
```

#### Step 3: Monitor Key Indicators
Watch logs for these patterns:
- ✅ `[MA] ✅ VALIDATION PASSED` - Position validation working
- ✅ `[MA] 💰 BALANCE DETAILS` - Comprehensive logging active
- ❌ `[MA] ❌ VALIDATION FAILED` - Should prevent invalid trades
- 🚨 Any Discord notifications about validation failures

### Phase 4: Additional Strategy Enablement
**Only after 24-48 hours of successful MA operation:**

1. Enable **OSCILLATOR** strategy next (most conservative)
2. Then **RSI** strategy  
3. Monitor each for 24 hours before enabling next
4. **NEVER enable all strategies simultaneously**

### Phase 5: High-Risk Strategy Re-enablement
**Only after 1 week of stable operation:**
- Consider enabling MACD, BOLLINGER_BANDS
- **NEVER enable HFT, MUTUAL_INFO until thorough review**

## 🔍 Monitoring Checklist

### Critical Monitoring Points
- [ ] Position validation logs appear before each sell order
- [ ] Balance details logged with Free/Used/Total amounts
- [ ] No position close failures due to insufficient balance
- [ ] Discord notifications working for validation failures
- [ ] No "pre_saved" status orders accumulating
- [ ] Exchange API responses remain stable

### Warning Signs to Watch For
🚨 **IMMEDIATE STOP if you see:**
- Position validation being bypassed
- Sell orders executing without validation logs
- Balance discrepancy errors
- Multiple position close failures
- Container crashes or restarts

## 📞 Emergency Procedures

### If Problems Occur:
1. **Immediately disable strategy in config.js**
2. **Run closeAllPositions.js to clear positions** 
3. **Check for stuck orders**
4. **Post status to Discord using claude-discord-bot**

### Emergency Commands:
```bash
# Emergency shutdown
docker-compose stop bot

# Emergency position close
node scripts/closeAllPositions.js

# Discord notification
claude-discord-bot send-to-discord "Emergency shutdown executed - investigating issues" --session claude-harvest
```

## ✅ Success Criteria
System restart is considered successful when:
- [ ] Single strategy operates for 24+ hours without validation failures
- [ ] All position closes are preceded by successful validation
- [ ] Comprehensive logging provides clear error tracking
- [ ] No phantom positions or stuck orders occur
- [ ] Discord notifications work correctly for any issues

## 📝 Post-Restart Actions
1. Document any issues encountered
2. Update CLAUDE.md with lessons learned
3. Consider additional monitoring enhancements
4. Plan gradual re-enablement of remaining strategies

---
**REMEMBER: Safety first. Better to operate with limited strategies than risk system-wide failures.**