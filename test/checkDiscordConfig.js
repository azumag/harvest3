const { postErrorToDiscord } = require('../src/common/notifications');

/**
 * Discord通知設定の確認
 */
async function checkDiscordConfig() {
  console.log('=== Discord Configuration Check ===');
  
  // 環境変数の確認
  const discordErrorUrl = process.env.DISCORD_ERROR_WEBHOOK_URL;
  console.log('DISCORD_ERROR_WEBHOOK_URL:', discordErrorUrl ? '設定済み' : '未設定');
  
  if (discordErrorUrl) {
    console.log('Discord URL (最初の20文字):', discordErrorUrl.substring(0, 20) + '...');
  }
  
  // テスト通知の送信
  if (discordErrorUrl) {
    console.log('\\nテスト通知を送信中...');
    try {
      await postErrorToDiscord('🔧 Bitbank API Error Notification Test - システム正常稼働中');
      console.log('✅ テスト通知の送信に成功しました');
    } catch (error) {
      console.error('❌ テスト通知の送信に失敗しました:', error.message);
    }
  } else {
    console.log('❌ Discord Webhook URLが設定されていないため、通知テストをスキップします');
    console.log('\\n設定方法:');
    console.log('export DISCORD_ERROR_WEBHOOK_URL="https://discord.com/api/webhooks/..."');
  }
}

// テスト実行
if (require.main === module) {
  checkDiscordConfig();
}

module.exports = { checkDiscordConfig };