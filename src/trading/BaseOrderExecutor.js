/**
 * 注文実行の基底クラス
 * BuyOrderExecutor と SellOrderExecutor で共有される共通機能
 */

class BaseOrderExecutor {
    constructor(strategyName) {
        this.strategyName = strategyName;
    }

    /**
     * バリデーション失敗時の共通処理
     * @param {string} reason - 失敗理由
     * @param {Object} context - 追加のコンテキスト情報
     * @returns {Object} 標準エラーレスポンス
     */
    handleValidationFailure(reason, context = {}) {
        const errorResponse = {
            success: false,
            reason,
            context,
            timestamp: new Date().toISOString(),
            strategy: this.strategyName
        };
        
        console.warn(`[${this.strategyName}] Validation failed: ${reason}`, context);
        return errorResponse;
    }

    /**
     * 注文作成エラーの共通ハンドリング
     * @param {Error} orderError - 注文エラー
     * @param {Object} orderParams - 注文パラメータ
     * @returns {Object} エラーレスポンス
     */
    handleOrderCreationError(orderError, orderParams) {
        const { amount, currentPrice } = orderParams;
        
        console.error(`[${this.strategyName}] Order creation failed:`, orderError);
        return this.handleValidationFailure('Order creation failed', { 
            error: orderError.message,
            amount,
            currentPrice 
        });
    }

    /**
     * 成功レスポンスの生成
     * @param {Object} order - 作成された注文
     * @param {Object} signalInfo - シグナル情報
     * @param {string} signal - シグナルタイプ ('buy' または 'sell')
     * @returns {Object} 成功レスポンス
     */
    createSuccessResponse(order, signalInfo, signal) {
        return {
            success: true,
            order,
            signal,
            timestamp: new Date().toISOString(),
            strategy: this.strategyName,
            ...signalInfo
        };
    }

    /**
     * 注文パラメータのバリデーション
     * @param {number} amount - 注文数量
     * @param {number} currentPrice - 現在価格
     * @returns {Object|null} バリデーションエラーまたはnull
     */
    validateOrderParams(amount, currentPrice) {
        if (!amount || amount <= 0) {
            return this.handleValidationFailure('Invalid amount', { amount });
        }
        
        if (!currentPrice || currentPrice <= 0) {
            return this.handleValidationFailure('Invalid current price', { currentPrice });
        }
        
        return null; // バリデーション成功
    }

    /**
     * 注文実行の共通ラッパー
     * @param {Function} orderCreationFunc - 注文作成関数
     * @param {Object} params - 注文パラメータ
     * @param {Object} signalInfo - シグナル情報
     * @param {string} signal - シグナルタイプ
     * @returns {Promise<Object>} 注文結果
     */
    async executeOrder(orderCreationFunc, params, signalInfo, signal) {
        const { amount, currentPrice } = params;
        
        // 共通バリデーション
        const validationError = this.validateOrderParams(amount, currentPrice);
        if (validationError) {
            return validationError;
        }

        try {
            // 注文作成
            const order = await orderCreationFunc(params);
            
            // 成功レスポンス生成
            return this.createSuccessResponse(order, signalInfo, signal);
            
        } catch (orderError) {
            // エラーハンドリング
            return this.handleOrderCreationError(orderError, params);
        }
    }

    /**
     * 注文サイズの計算（サブクラスで実装）
     * @param {Object} params - 計算パラメータ
     * @returns {number} 注文サイズ
     */
    calculateOrderSize(params) {
        throw new Error('calculateOrderSize() must be implemented by subclass');
    }

    /**
     * 注文価格の計算（サブクラスで実装）
     * @param {number} currentPrice - 現在価格
     * @param {Object} params - 計算パラメータ
     * @returns {number} 注文価格
     */
    calculateOrderPrice(currentPrice, params) {
        throw new Error('calculateOrderPrice() must be implemented by subclass');
    }
}

module.exports = BaseOrderExecutor;