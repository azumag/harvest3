#!/bin/bash

# database-connector.sh
# Redis・MongoDB接続チェック・リトライ処理
# Issue #5351: entrypoint.shリファクタリング - 単一責任の原則適用

# データベース接続チェック関数（共通化）
check_database_connection() {
    local service_name="$1"
    local check_command="$2"
    local max_retries=3
    local retry_delay=5
    
    log "Testing $service_name connection with retry..."
    local retry=0
    while [ $retry -lt $max_retries ]; do
        if eval "$check_command" 2>/dev/null; then
            log "$service_name connection verified successfully (attempt $((retry + 1)))"
            return 0
        else
            retry=$((retry + 1))
            if [ $retry -lt $max_retries ]; then
                log "$service_name connection failed (attempt $retry/$max_retries), retrying in ${retry_delay}s..."
                sleep $retry_delay
            else
                log "WARNING: $service_name connection failed after $max_retries attempts (service will retry later)"
                return 1
            fi
        fi
    done
}

# データベース接続チェック（統合版）
check_database_connections() {
    log "Checking database connections with retry logic..."
    
    local redis_failed=false
    local mongo_failed=false
    
    # Redis接続チェック
    local redis_check="node -e '
        const redis = require(\"redis\");
        const client = redis.createClient({url: process.env.REDIS_URL});
        client.connect()
            .then(() => { 
                console.log(\"Redis connection OK\"); 
                return client.quit();
            })
            .then(() => process.exit(0))
            .catch(err => { 
                console.error(\"Redis connection failed:\", err.message); 
                process.exit(1); 
            });
        setTimeout(() => { 
            console.error(\"Redis connection timeout\"); 
            process.exit(1); 
        }, ${DATABASE_CONNECTION_TIMEOUT}000);'"
    
    if ! check_database_connection "Redis" "$redis_check"; then
        redis_failed=true
    fi
    
    # MongoDB接続チェック
    local mongo_check="node -e '
        const { MongoClient } = require(\"mongodb\");
        const client = new MongoClient(process.env.MONGO_URL);
        client.connect()
            .then(() => { 
                console.log(\"MongoDB connection OK\"); 
                return client.close(); 
            })
            .then(() => process.exit(0))
            .catch(err => { 
                console.error(\"MongoDB connection failed:\", err.message); 
                process.exit(1); 
            });
        setTimeout(() => { 
            console.error(\"MongoDB connection timeout\"); 
            process.exit(1); 
        }, ${DATABASE_CONNECTION_TIMEOUT}000);'"
    
    if ! check_database_connection "MongoDB" "$mongo_check"; then
        mongo_failed=true
    fi
    
    # 両方のデータベースが失敗した場合のみエラー終了
    if [ "$redis_failed" = true ] && [ "$mongo_failed" = true ]; then
        local error_msg="All database connections failed after retry attempts"
        log "ERROR: $error_msg"
        send_startup_error_to_discord "$error_msg" "Both Redis and MongoDB connectivity failed after retries"
        exit 1
    fi
    
    log "Database connectivity check completed (some connections may retry automatically)"
}