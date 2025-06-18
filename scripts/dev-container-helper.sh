#!/bin/bash

# Dev Container Docker Compose Helper Script
# This script helps resolve volume mount issues when running docker-compose from within a dev container

echo "=== Harvest3 Dev Container Docker Helper ==="
echo

# Check if we're in a dev container
if [ -d "/workspace" ] && [[ "$(pwd)" == "/workspace"* ]]; then
    echo "✅ Detected dev container environment"
    echo "Current directory: $(pwd)"
    
    # Check if we're in the project root
    if [ -f "docker-compose.yml" ] && [ -f "package.json" ]; then
        echo "✅ Located in project root directory"
    else
        echo "❌ Not in project root. Please cd to /workspace"
        exit 1
    fi
    
    # Check Docker socket access
    if docker ps >/dev/null 2>&1; then
        echo "✅ Docker daemon accessible"
    else
        echo "❌ Cannot access Docker daemon"
        echo "Try: sudo chmod 666 /var/run/docker.sock"
        exit 1
    fi
    
else
    echo "ℹ️  Not in dev container environment - running on host"
fi

echo
echo "=== Volume Mount Test ==="

# Create test file to verify volume mounting
TEST_FILE="data/volume-test-$(date +%s).txt"
mkdir -p data
echo "Volume mount test: $(date)" > "$TEST_FILE"
echo "Created test file: $TEST_FILE"

# Function to run docker-compose with proper context
run_compose() {
    local command="$1"
    echo "Running: docker compose $command"
    
    # For dev container, ensure we're using the correct context
    if [ -d "/workspace" ] && [[ "$(pwd)" == "/workspace"* ]]; then
        # In dev container - paths should resolve correctly since we're mounted to /workspace
        docker compose $command
    else
        # On host - standard execution
        docker compose $command
    fi
}

# Test basic functionality
echo
echo "=== Testing Docker Compose ==="
echo "Building web-ui service to test volume mounts..."

if run_compose "build web-ui"; then
    echo "✅ Build successful"
    
    echo
    echo "Testing volume mount with temporary container..."
    
    # Test volume mount by running a simple command that reads our test file
    if docker run --rm \
        -v "$(pwd)/data:/usr/src/app/data" \
        alpine:latest \
        cat "/usr/src/app/data/$(basename "$TEST_FILE")" 2>/dev/null; then
        echo "✅ Volume mount test successful - file content retrieved from container"
    else
        echo "❌ Volume mount test failed - file not accessible from container"
        echo "This indicates a volume mount path resolution issue"
    fi
    
else
    echo "❌ Build failed - check network connectivity and Docker configuration"
fi

# Cleanup
rm -f "$TEST_FILE"

echo
echo "=== Usage Instructions ==="
echo
echo "To run the application:"
echo "  1. Ensure you're in the project root (/workspace in dev container)"
echo "  2. Run: docker compose up -d"
echo "  3. Check logs: docker compose logs -f [service-name]"
echo "  4. Stop: docker compose down"
echo
echo "For volume mount issues:"
echo "  - Verify Docker socket permissions: ls -la /var/run/docker.sock"  
echo "  - Check current directory: pwd (should be /workspace)"
echo "  - Verify file paths resolve: ls -la ./data ./src"
echo
echo "Common fixes:"
echo "  - sudo chmod 666 /var/run/docker.sock (temporary fix for permissions)"
echo "  - Restart dev container if Docker daemon is not accessible"
echo "  - Use absolute paths in docker-compose.yml if relative paths fail"
echo
echo "=== Dev Container Docker Helper Complete ==="