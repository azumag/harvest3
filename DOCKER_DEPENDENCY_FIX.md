# Docker Dependency Fix - Missing 'zod' Module

## 🚨 Problem Analysis

**Error**: `Cannot find module 'zod'` in Docker container  
**Root Cause**: The Docker container was built without the `zod` dependency installed  
**Impact**: Backtest container cannot start due to missing schema validation module

## 🔧 Immediate Solutions

### Solution 1: Quick Fix - Install in Running Container (Fastest)

```bash
# Install zod directly in the running container
docker exec -it backtest npm install zod

# Restart the backtest service
docker-compose restart backtest
```

### Solution 2: Rebuild Container with Dependencies (Recommended)

```bash
# Stop the backtest container
docker-compose stop backtest

# Rebuild the container with updated dependencies
docker-compose build --no-cache backtest

# Restart with fresh build
docker-compose up -d backtest
```

### Solution 3: Fix Docker Build Process (Long-term)

Update the Dockerfile to ensure all dependencies are properly installed:

```dockerfile
# Add after line 28 in Dockerfile
RUN npm install 
RUN npm ls zod || npm install zod  # Ensure zod is installed
RUN npm audit fix --force          # Fix any dependency issues
```

## 🛠️ Complete Rebuild Commands

If you need to completely rebuild everything:

```bash
# Stop all services
docker-compose down

# Remove existing images
docker rmi $(docker images -q harvest3-bot-image)

# Rebuild everything
docker-compose build --no-cache

# Start services
docker-compose up -d
```

## 🔍 Verification Steps

After applying any fix, verify the installation:

```bash
# Check if zod is installed in container
docker exec -it backtest npm ls zod

# Test the backtest command
docker exec -it backtest npm run backtest

# Check container logs
docker logs backtest --tail 50
```

## 📋 Root Cause Analysis

### Why This Happened

1. **Docker Build Cache**: Previous build may have cached state without zod
2. **Package.json Changes**: zod was added after container was built
3. **Volume Mounts**: node_modules might be overwritten by host volumes
4. **Build Context**: Dependencies not properly copied during build

### Prevention Measures

1. **Always rebuild after package.json changes**:
   ```bash
   docker-compose build --no-cache
   ```

2. **Add dependency verification to Dockerfile**:
   ```dockerfile
   RUN npm ls zod || (echo "zod missing" && exit 1)
   ```

3. **Use .dockerignore to prevent node_modules conflicts**:
   ```
   node_modules
   npm-debug.log
   ```

## 🚀 Recommended Action Plan

### Step 1: Immediate Fix (2 minutes)
```bash
# Quick install in running container
docker exec -it backtest npm install zod
docker-compose restart backtest
```

### Step 2: Verify Fix (1 minute)
```bash
# Test that backtest works
docker exec -it backtest npm run backtest
```

### Step 3: Long-term Fix (5 minutes)
```bash
# Proper rebuild to prevent future issues
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## 📊 Expected Outcomes

After applying the fix:

✅ **Backtest container starts successfully**  
✅ **zod module properly loaded**  
✅ **Schema validation works correctly**  
✅ **Backtest runner executes without errors**

## 🔧 Alternative: Local Development Fix

If Docker continues to have issues, you can run backtest locally:

```bash
# Ensure dependencies are installed locally
npm install

# Run backtest locally with Docker databases
REDIS_URL=redis://localhost:6379 MONGO_URL=mongodb://localhost:27017 MONGO_DB_NAME=harvest3 npm run backtest
```

## 🚨 If Problems Persist

If the above solutions don't work:

1. **Check package-lock.json conflicts**:
   ```bash
   rm package-lock.json node_modules -rf
   npm install
   docker-compose build --no-cache
   ```

2. **Verify Docker Compose configuration**:
   - Check that package.json is properly copied
   - Ensure no volume mounts override node_modules
   - Verify build context includes all necessary files

3. **Debug container build**:
   ```bash
   docker build -t debug-harvest3 .
   docker run -it debug-harvest3 /bin/bash
   npm ls zod
   ```

Choose **Solution 1** for immediate resolution, then follow up with **Solution 2** for a permanent fix.