const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { expect } = require('chai');

describe('CI Success Detector Workflow', () => {
  let workflowConfig;
  
  before(() => {
    // ワークフローファイルを読み込み
    const workflowPath = path.join(__dirname, '../../../.github/workflows/ci-success-detector.yml');
    const workflowContent = fs.readFileSync(workflowPath, 'utf8');
    workflowConfig = yaml.load(workflowContent);
  });

  describe('ワークフロー設定', () => {
    it('正しいワークフロー名が設定されている', () => {
      expect(workflowConfig.name).to.equal('CI Success Detector');
    });

    it('workflow_runトリガーが設定されている', () => {
      expect(workflowConfig.on).to.have.property('workflow_run');
      expect(workflowConfig.on.workflow_run.workflows).to.include('CI/CD Pipeline');
      expect(workflowConfig.on.workflow_run.types).to.include('completed');
    });
  });

  describe('ジョブ設定', () => {
    let job;

    before(() => {
      job = workflowConfig.jobs['auto-add-success-label'];
    });

    it('正しいジョブ名が設定されている', () => {
      expect(job.name).to.equal('Add CI Success Label');
    });

    it('Ubuntu最新版で実行される', () => {
      expect(job['runs-on']).to.equal('ubuntu-latest');
    });

    it('CI成功時のみ実行される条件が設定されている', () => {
      expect(job.if).to.include("github.event.workflow_run.conclusion == 'success'");
      expect(job.if).to.include("github.event.workflow_run.event == 'pull_request'");
    });

    it('必要な権限が設定されている', () => {
      expect(job.permissions).to.deep.equal({
        contents: 'read',
        'pull-requests': 'write',
        issues: 'write',
        actions: 'read'
      });
    });
  });

  describe('ステップ設定', () => {
    let steps;

    before(() => {
      steps = workflowConfig.jobs['auto-add-success-label'].steps;
    });

    it('1つのステップが設定されている', () => {
      expect(steps).to.have.length(1);
    });

    it('GitHub Scriptアクションを使用している', () => {
      const step = steps[0];
      expect(step.uses).to.equal('actions/github-script@v7');
    });

    it('正しいステップ名が設定されている', () => {
      const step = steps[0];
      expect(step.name).to.equal('Add CI Success Label');
    });

    it('スクリプトが設定されている', () => {
      const step = steps[0];
      expect(step.with).to.have.property('script');
      expect(step.with.script).to.be.a('string');
      expect(step.with.script.length).to.be.greaterThan(0);
    });

    it('ci-passedラベルの追加処理が含まれている', () => {
      const step = steps[0];
      expect(step.with.script).to.include('ci-passed');
      expect(step.with.script).to.include('addLabels');
    });

    it('ci-failureラベルの削除処理が含まれている', () => {
      const step = steps[0];
      expect(step.with.script).to.include('ci-failure');
      expect(step.with.script).to.include('removeLabel');
    });
  });

  describe('ワークフローファイルの構文', () => {
    it('有効なYAML形式である', () => {
      // yaml.loadが例外を投げなければ有効
      expect(workflowConfig).to.be.an('object');
    });

    it('必須フィールドが含まれている', () => {
      expect(workflowConfig).to.have.property('name');
      expect(workflowConfig).to.have.property('on');
      expect(workflowConfig).to.have.property('jobs');
    });
  });

  describe('スクリプトロジック', () => {
    let script;

    before(() => {
      script = workflowConfig.jobs['auto-add-success-label'].steps[0].with.script;
    });

    it('Pull Request番号の取得処理が含まれている', () => {
      expect(script).to.include('pulls.list');
      expect(script).to.include('prNumber');
    });

    it('ラベル追加処理が含まれている', () => {
      expect(script).to.include('issues.addLabels');
      expect(script).to.include("labels: ['ci-passed']");
    });

    it('ラベル削除処理が含まれている', () => {
      expect(script).to.include('issues.removeLabel');
      expect(script).to.include("name: 'ci-failure'");
    });

    it('エラーハンドリングが含まれている', () => {
      expect(script).to.include('.catch(');
    });

    it('ログ出力が含まれている', () => {
      expect(script).to.include('console.log');
    });
  });
});