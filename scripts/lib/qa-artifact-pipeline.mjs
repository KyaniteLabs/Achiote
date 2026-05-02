import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const QA_ARTIFACT_MANIFEST_FILE = 'run-manifest.json';

export function referenceDataFingerprint(root = process.cwd(), relativePaths = referenceDataFingerprintPaths()) {
  const hasher = createHash('sha256');
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(root, relativePath);
    hasher.update(relativePath);
    hasher.update('\0');
    hasher.update(fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath) : '');
    hasher.update('\0');
  }
  return hasher.digest('hex').slice(0, 16);
}

export function referenceDataFingerprintPaths() {
  return [
    'src/data/reference-pantry-fixtures.json',
    'src/data/reference-seed-queue.json',
    'src/data/cache-warming-manifest.json',
  ];
}

export function latestPriorQaManifest(root = process.cwd(), artifactDir) {
  const artifactsRoot = path.join(root, 'artifacts');
  const currentArtifactDir = artifactDir ? path.resolve(artifactDir) : undefined;
  if (!fs.existsSync(artifactsRoot)) return undefined;
  const manifestPaths = findManifestPaths(artifactsRoot)
    .filter((manifestPath) => !currentArtifactDir || !manifestPath.startsWith(`${currentArtifactDir}${path.sep}`));
  const manifests = manifestPaths
    .map((manifestPath) => ({ manifestPath, stat: safeStat(manifestPath) }))
    .filter((item) => item.stat)
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  for (const item of manifests) {
    try {
      const parsed = JSON.parse(fs.readFileSync(item.manifestPath, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Ignore incomplete or stale artifacts.
    }
  }
  return undefined;
}

export function buildQaRunManifest(input = {}) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const root = input.root ?? process.cwd();
  const artifactDir = input.artifactDir ? path.resolve(input.artifactDir) : '';
  const promptBank = input.promptBank ?? {};
  const referenceFingerprint = input.referenceFingerprint
    ?? promptBank.referenceFingerprint
    ?? referenceDataFingerprint(root);

  return {
    schema: 'achiote.qa-artifact-manifest.v1',
    generatedAt,
    artifactDir,
    runKind: String(input.runKind ?? 'qa'),
    stopCondition: String(input.stopCondition ?? ''),
    samplePlan: {
      promptIds: Array.isArray(input.promptIds) ? [...input.promptIds] : [],
      sampleCount: Array.isArray(input.promptIds) ? input.promptIds.length : Number(input.sampleCount ?? 0),
      searchDisabledPromptIds: Array.isArray(input.searchDisabledPromptIds) ? [...input.searchDisabledPromptIds] : [],
    },
    runtime: {
      providers: Array.isArray(input.providers) ? [...input.providers] : [],
      models: Array.isArray(input.models) ? [...input.models] : [],
      profile: String(input.profile ?? ''),
      endpointStyle: String(input.endpointStyle ?? ''),
    },
    referenceData: {
      fingerprint: referenceFingerprint,
      paths: referenceDataFingerprintPaths(),
    },
    promptBank: {
      id: String(promptBank.id ?? ''),
      description: String(promptBank.description ?? ''),
      referenceFingerprint: String(promptBank.referenceFingerprint ?? referenceFingerprint),
      previousPromptBankId: String(promptBank.previousPromptBankId ?? ''),
      previousReferenceFingerprint: String(promptBank.previousReferenceFingerprint ?? ''),
      rotatedAfterReferenceUpdate: Boolean(promptBank.rotatedAfterReferenceUpdate),
    },
    qualityGates: {
      excludedEvidenceReasons: Array.isArray(input.excludedEvidenceReasons) ? [...input.excludedEvidenceReasons] : [],
      requiredLabels: Array.isArray(input.requiredLabels) ? [...input.requiredLabels] : [],
      forbiddenLabels: Array.isArray(input.forbiddenLabels) ? [...input.forbiddenLabels] : [],
    },
    outputs: input.outputs && typeof input.outputs === 'object' ? { ...input.outputs } : {},
  };
}

export function writeQaRunManifest(manifestPath, input = {}) {
  const manifest = buildQaRunManifest(input);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function findManifestPaths(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return findManifestPaths(entryPath);
    return entry.name === QA_ARTIFACT_MANIFEST_FILE ? [entryPath] : [];
  });
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}
