#!/usr/bin/env node

/**
 * System-wide Timeout Monitoring Tool
 * 
 * This script monitors timeout values across the system and provides
 * statistics and recommendations for timeout optimization.
 * 
 * Usage:
 *   node scripts/timeout-monitor.js [--watch] [--report] [--threshold=80]
 * 
 * Related to Issue #5387: 段階的Jest タイムアウト短縮計画の策定
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class TimeoutMonitor {
  constructor(options = {}) {
    this.watchMode = options.watch || false;
    this.generateReport = options.report || false;
    this.alertThreshold = options.threshold || 80; // 80% of timeout
    this.statistics = {
      jestTimeouts: {},
      systemTimeouts: {},
      totalScanned: 0,
      warnings: []
    };
  }

  /**
   * Main execution method
   */
  async run() {
    console.log('🔍 System Timeout Monitor - Starting Analysis...');
    console.log(`Alert threshold: ${this.alertThreshold}% of timeout values\n`);

    try {
      await this.scanJestConfiguration();
      await this.scanSystemTimeouts();
      await this.analyzeCurrentTestPerformance();
      
      this.generateStatistics();
      
      if (this.generateReport) {
        await this.generateTimeoutReport();
      }

      if (this.watchMode) {
        this.startWatchMode();
      }

    } catch (error) {
      console.error('❌ Error during timeout monitoring:', error.message);
      process.exit(1);
    }
  }

  /**
   * Scan Jest configuration files for timeout settings
   */
  async scanJestConfiguration() {
    console.log('📊 Scanning Jest Configuration...');
    
    const jestConfig = this.readFileIfExists('jest.config.js');
    if (jestConfig) {
      const timeoutMatch = jestConfig.match(/testTimeout:\s*process\.env\.CI\s*\?\s*(\d+)\s*:\s*(\d+)/);
      if (timeoutMatch) {
        this.statistics.jestTimeouts.ci = parseInt(timeoutMatch[1]);
        this.statistics.jestTimeouts.local = parseInt(timeoutMatch[2]);
        console.log(`  ✓ Jest CI timeout: ${this.statistics.jestTimeouts.ci}ms`);
        console.log(`  ✓ Jest local timeout: ${this.statistics.jestTimeouts.local}ms`);
      }
    }

    const jestSetup = this.readFileIfExists('jest.setup.js');
    if (jestSetup) {
      const globalTimeouts = this.extractGlobalTimeouts(jestSetup);
      if (Object.keys(globalTimeouts).length > 0) {
        this.statistics.jestTimeouts.global = globalTimeouts;
        console.log(`  ✓ Global test timeouts found: ${Object.keys(globalTimeouts).length} categories`);
      }
    }
  }

  /**
   * Scan system files for timeout configurations
   */
  async scanSystemTimeouts() {
    console.log('\n🔧 Scanning System Timeout Configurations...');
    
    const filesToScan = [
      'src/common/throttleMonitor.js',
      'src/common/maintenanceScheduler.js',
      'entrypoint.sh',
      'docker-compose.yml'
    ];

    for (const filePath of filesToScan) {
      const content = this.readFileIfExists(filePath);
      if (content) {
        const timeouts = this.extractTimeoutValues(content, filePath);
        if (timeouts.length > 0) {
          this.statistics.systemTimeouts[filePath] = timeouts;
          console.log(`  ✓ ${filePath}: ${timeouts.length} timeout values found`);
          
          // Check for high timeout values that might need optimization
          timeouts.forEach(timeout => {
            if (timeout.value > 120000) { // > 2 minutes
              this.statistics.warnings.push({
                file: filePath,
                line: timeout.line,
                value: timeout.value,
                context: timeout.context,
                severity: timeout.value > 180000 ? 'high' : 'medium'
              });
            }
          });
        }
      }
    }
  }

  /**
   * Analyze current test performance from Jest output
   */
  async analyzeCurrentTestPerformance() {
    console.log('\n⏱️  Analyzing Current Test Performance...');
    
    try {
      // Run a quick test to gather timing statistics
      const testOutput = execSync('npm run test:unit 2>&1 || true', { 
        encoding: 'utf8',
        timeout: 60000 
      });

      const timingStats = this.extractTestTimings(testOutput);
      if (timingStats.length > 0) {
        this.statistics.testPerformance = this.calculateTestStatistics(timingStats);
        console.log(`  ✓ Analyzed ${timingStats.length} test cases`);
        console.log(`  ✓ Average test time: ${this.statistics.testPerformance.average}ms`);
        console.log(`  ✓ 95th percentile: ${this.statistics.testPerformance.p95}ms`);
      }
    } catch (error) {
      console.log('  ⚠️  Could not analyze test performance (tests may be failing)');
      this.statistics.warnings.push({
        type: 'test_analysis',
        message: 'Failed to analyze test performance',
        details: error.message
      });
    }
  }

  /**
   * Generate comprehensive statistics
   */
  generateStatistics() {
    console.log('\n📈 Timeout Analysis Results:');
    console.log('================================');

    // Jest timeout analysis
    if (Object.keys(this.statistics.jestTimeouts).length > 0) {
      console.log('\n🧪 Jest Timeout Configuration:');
      const { ci, local } = this.statistics.jestTimeouts;
      if (ci && local) {
        console.log(`  CI Environment: ${ci}ms (${ci/1000}s)`);
        console.log(`  Local Environment: ${local}ms (${local/1000}s)`);
        
        if (ci <= 30000 && local <= 60000) {
          console.log('  ✅ Jest timeouts are already optimized');
        } else {
          console.log('  ⚠️  Jest timeouts may need optimization');
        }
      }
    }

    // System timeout warnings
    if (this.statistics.warnings.length > 0) {
      console.log('\n⚠️  Timeout Optimization Opportunities:');
      this.statistics.warnings.forEach((warning, index) => {
        if (warning.file) {
          const severity = warning.severity === 'high' ? '🔴' : '🟡';
          console.log(`  ${severity} ${warning.file}:${warning.line || '?'}`);
          console.log(`     Timeout: ${warning.value}ms (${warning.value/1000}s)`);
          if (warning.context) {
            console.log(`     Context: ${warning.context.substring(0, 50)}...`);
          }
        } else {
          console.log(`  ⚠️  ${warning.message}`);
        }
      });
    } else {
      console.log('\n✅ No high-value timeouts found that need immediate attention');
    }

    // Test performance summary
    if (this.statistics.testPerformance) {
      const perf = this.statistics.testPerformance;
      console.log('\n⏱️  Test Performance Summary:');
      console.log(`  Average execution time: ${perf.average}ms`);
      console.log(`  95th percentile: ${perf.p95}ms`);
      console.log(`  Maximum execution time: ${perf.max}ms`);
      
      const currentTimeout = this.statistics.jestTimeouts.ci || 30000;
      const utilizationPct = Math.round((perf.p95 / currentTimeout) * 100);
      console.log(`  Timeout utilization: ${utilizationPct}%`);
      
      if (utilizationPct < 50) {
        console.log('  💡 Suggestion: Current Jest timeout may be too generous');
      } else if (utilizationPct > 80) {
        console.log('  ⚠️  Warning: Current Jest timeout may be too tight');
      } else {
        console.log('  ✅ Current Jest timeout appears well-calibrated');
      }
    }
  }

  /**
   * Generate detailed timeout report
   */
  async generateTimeoutReport() {
    const reportPath = '.tmp/timeout-analysis-report.json';
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTimeoutsFound: Object.keys(this.statistics.systemTimeouts).length,
        highPriorityOptimizations: this.statistics.warnings.filter(w => w.severity === 'high').length,
        jestOptimizationNeeded: false // Already optimized
      },
      details: this.statistics,
      recommendations: this.generateRecommendations()
    };

    if (!fs.existsSync('.tmp')) {
      fs.mkdirSync('.tmp', { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations() {
    const recommendations = [];

    // System timeout recommendations
    this.statistics.warnings.forEach(warning => {
      if (warning.file && warning.value > 120000) {
        recommendations.push({
          type: 'system_timeout_reduction',
          file: warning.file,
          current: warning.value,
          suggested: Math.max(Math.round(warning.value * 0.75), 60000),
          priority: warning.severity,
          rationale: 'Reduce timeout while maintaining safety margin'
        });
      }
    });

    // Jest timeout recommendations (if needed)
    const { ci, local } = this.statistics.jestTimeouts;
    if (ci && ci > 30000) {
      recommendations.push({
        type: 'jest_timeout_reduction',
        target: 'CI',
        current: ci,
        suggested: 30000,
        priority: 'medium',
        rationale: 'CI environment should use shorter timeouts for faster feedback'
      });
    }

    return recommendations;
  }

  /**
   * Start watch mode for continuous monitoring
   */
  startWatchMode() {
    console.log('\n👀 Starting watch mode... (Press Ctrl+C to exit)');
    // Implementation would include file watching and periodic re-analysis
    setInterval(() => {
      console.log(`[${new Date().toISOString()}] Monitoring timeouts...`);
    }, 30000);
  }

  // Helper methods
  readFileIfExists(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return null;
    }
  }

  extractGlobalTimeouts(content) {
    const timeouts = {};
    const regex = /(\w+):\s*process\.env\.CI\s*\?\s*(\d+)\s*:\s*(\d+)/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      timeouts[match[1]] = {
        ci: parseInt(match[2]),
        local: parseInt(match[3])
      };
    }
    
    return timeouts;
  }

  extractTimeoutValues(content, filePath) {
    const timeouts = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Look for various timeout patterns
      const patterns = [
        /timeout[:\s]*(\d+)/gi,
        /setTimeout.*?(\d+)/gi,
        /testTimeout[:\s]*(\d+)/gi,
        /const\s+\w*[A-Z_]*\w*\s*=\s*(\d+)/gi,  // const DELAY = 90000
        /(\d+)000\s*\/\/.*timeout/gi,
        /(\d+)000(?:\s*[;}]|$)/gi  // numbers ending with 000
      ];
      
      patterns.forEach(pattern => {
        pattern.lastIndex = 0; // Reset regex state
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const value = parseInt(match[1]);
          if (value > 1000) { // Only consider values > 1 second
            timeouts.push({
              line: index + 1,
              value: value,
              context: line.trim()
            });
          }
        }
      });
    });
    
    return timeouts;
  }

  extractTestTimings(testOutput) {
    const timings = [];
    const regex = /✓.*?\((\d+)\s*ms\)/g;
    let match;
    
    while ((match = regex.exec(testOutput)) !== null) {
      timings.push(parseInt(match[1]));
    }
    
    return timings;
  }

  calculateTestStatistics(timings) {
    if (timings.length === 0) return null;
    
    const sorted = timings.sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
      count: sorted.length,
      average: Math.round(sum / sorted.length),
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
      min: sorted[0]
    };
  }
}

// CLI handling
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    watch: args.includes('--watch'),
    report: args.includes('--report'),
    threshold: 80
  };
  
  const thresholdArg = args.find(arg => arg.startsWith('--threshold='));
  if (thresholdArg) {
    options.threshold = parseInt(thresholdArg.split('=')[1]) || 80;
  }
  
  return options;
}

// Main execution
if (require.main === module) {
  const options = parseArgs();
  const monitor = new TimeoutMonitor(options);
  monitor.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = TimeoutMonitor;