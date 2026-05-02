import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('QA artifact pipeline', () => {
  it('fingerprints reference population inputs and discovers prior run manifests', async () => {
    const {
      latestPriorQaManifest,
      referenceDataFingerprint,
      writeQaRunManifest,
    } = await import('../scripts/lib/qa-artifact-pipeline.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-qa-pipeline-'));
    fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
    fs.mkdirSync(path.join(root, 'artifacts/previous'), { recursive: true });
    fs.mkdirSync(path.join(root, 'artifacts/current'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/data/reference-pantry-fixtures.json'), '{"fixtures":[]}');
    fs.writeFileSync(path.join(root, 'src/data/reference-seed-queue.json'), '{"seeds":[]}');
    fs.writeFileSync(path.join(root, 'src/data/cache-warming-manifest.json'), '{"tasks":[]}');

    const firstFingerprint = referenceDataFingerprint(root);
    const priorManifestPath = path.join(root, 'artifacts/previous/run-manifest.json');
    writeQaRunManifest(priorManifestPath, {
      root,
      artifactDir: path.join(root, 'artifacts/previous'),
      runKind: 'weak-cloud-overnight',
      promptBank: { id: 'bank-a', referenceFingerprint: firstFingerprint },
      promptIds: ['hard-memory-a'],
      providers: ['glm'],
      models: ['GLM-5.1'],
    });
    fs.appendFileSync(path.join(root, 'src/data/reference-pantry-fixtures.json'), '\n');

    const nextFingerprint = referenceDataFingerprint(root);
    const prior = latestPriorQaManifest(root, path.join(root, 'artifacts/current'));

    expect(nextFingerprint).not.toBe(firstFingerprint);
    expect(prior).toMatchObject({
      schema: 'achiote.qa-artifact-manifest.v1',
      runKind: 'weak-cloud-overnight',
      promptBank: { id: 'bank-a', referenceFingerprint: firstFingerprint },
      samplePlan: { promptIds: ['hard-memory-a'], sampleCount: 1 },
      runtime: { providers: ['glm'], models: ['GLM-5.1'] },
    });
  });

  it('keeps canary prompt-bank rotation on the shared manifest surface', async () => {
    const { selectWeakCloudPromptBank } = await import('../scripts/lib/canary-prompt-bank.mjs');
    const { writeQaRunManifest } = await import('../scripts/lib/qa-artifact-pipeline.mjs');
    const fixtures = fs.readFileSync('src/data/reference-pantry-fixtures.json', 'utf8');
    const seedQueue = fs.readFileSync('src/data/reference-seed-queue.json', 'utf8');
    const warmingManifest = fs.readFileSync('src/data/cache-warming-manifest.json', 'utf8');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-canary-bank-pipeline-'));
    fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/data/reference-pantry-fixtures.json'), fixtures);
    fs.writeFileSync(path.join(root, 'src/data/reference-seed-queue.json'), seedQueue);
    fs.writeFileSync(path.join(root, 'src/data/cache-warming-manifest.json'), warmingManifest);

    const first = selectWeakCloudPromptBank({ root, artifactDir: path.join(root, 'artifacts/current-run') });
    writeQaRunManifest(path.join(root, 'artifacts/previous-run/run-manifest.json'), {
      root,
      artifactDir: path.join(root, 'artifacts/previous-run'),
      runKind: 'weak-cloud-overnight',
      promptBank: first,
      promptIds: first.prompts.map((prompt) => prompt.id),
    });
    fs.appendFileSync(path.join(root, 'src/data/reference-pantry-fixtures.json'), '\n');

    const second = selectWeakCloudPromptBank({
      root,
      artifactDir: path.join(root, 'artifacts/current-run'),
      requestedBankId: first.id,
    });

    expect(second.previousPromptBankId).toBe(first.id);
    expect(second.previousReferenceFingerprint).toBe(first.referenceFingerprint);
    expect(second.id).not.toBe(first.id);
    expect(second.rotatedAfterReferenceUpdate).toBe(true);
  });

  it('wires local and weak-cloud runners to the shared manifest contract', () => {
    const localCanary = fs.readFileSync('scripts/local-canary-qa.mjs', 'utf8');
    const weakCloud = fs.readFileSync('scripts/weak-cloud-overnight.mjs', 'utf8');

    expect(localCanary).toContain("from './lib/qa-artifact-pipeline.mjs'");
    expect(localCanary).toContain('writeQaRunManifest');
    expect(localCanary).toContain("runKind: 'local-canary-qa'");
    expect(localCanary).toContain('forbidden_tool:search_web');
    expect(weakCloud).toContain("from './lib/qa-artifact-pipeline.mjs'");
    expect(weakCloud).toContain('buildQaRunManifest');
    expect(weakCloud).toContain("runKind: 'weak-cloud-overnight'");
    expect(weakCloud).toContain('excludedEvidenceReasons');
  });
});
