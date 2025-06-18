# Docker Volume Mount Issues - Analysis and Solutions

## Problem Description

The volume mount issue occurs when running `docker-compose` from within a VS Code dev container that uses "Docker-outside-Docker" configuration. The problem is related to path resolution differences between the dev container filesystem and the host filesystem.

## Root Cause

1. **Dev Container Setup**: The `.devcontainer` uses Docker-outside-Docker, mounting the host's Docker socket (`/var/run/docker.sock`) into the dev container.

2. **Path Resolution Mismatch**: When running `docker-compose` from within the dev container:
   - The dev container's current working directory is `/workspace` (mounted from host)
   - The `docker-compose.yml` uses relative paths like `./src:/usr/src/app/src`
   - The host Docker daemon interprets these paths relative to the HOST filesystem
   - But the relative paths may not resolve correctly from the host perspective

## Issues Found

1. **Missing `strategies` directory**: The Dockerfile expects `strategies/` in the project root, but it's located at `src/strategies/`
2. **Inconsistent volume mounts**: Some services mount `./strategies:/usr/src/app/strategies` but others don't
3. **Path resolution**: When running from dev container, volume mount paths may not resolve correctly

## Solutions Implemented

### 1. Fixed Missing Directories
- Created `strategies/` directory in project root
- Copied content from `src/strategies/` to maintain compatibility

### 2. Volume Mount Path Consistency
All services now use consistent volume mount patterns:
```yaml
volumes:
  - ./src:/usr/src/app/src
  - ./strategies:/usr/src/app/strategies  # Now available
  - ./data:/usr/src/app/data
  - ./package.json:/usr/src/app/package.json
  - .env:/usr/src/app/.env
```

### 3. Dev Container Recommendations

For reliable volume mounting from dev containers:

**Option A: Use absolute paths in docker-compose.yml**
```yaml
volumes:
  - ${PWD}/src:/usr/src/app/src
  - ${PWD}/data:/usr/src/app/data
```

**Option B: Ensure working directory context**
Always run docker-compose from the project root with proper context awareness.

**Option C: Use docker-compose from host (recommended)**
For most reliable behavior, run docker-compose directly from the host system rather than from within the dev container.

## Testing

Volume mounting has been tested and verified to work correctly with the current configuration. The test demonstrated that:
- Host files are visible in containers
- Container files are visible on host
- Bidirectional synchronization works as expected

## Usage Guidelines

1. **From Host System**: Run `docker-compose up` directly from the project root - this is the most reliable approach.

2. **From Dev Container**: If you must run from within the dev container, ensure you're in the `/workspace` directory and that all relative paths resolve correctly.

3. **File Changes**: After making changes to source files, containers with volume mounts should reflect changes immediately without rebuild.

4. **Debugging**: Use the test scripts provided to verify volume mount behavior in your specific environment.