#!/usr/bin/env node
/**
 * Claude Flow Agent Router
 * Routes tasks to optimal agents based on learned patterns
 */

const AGENT_CAPABILITIES = {
  coder: ['code-generation', 'refactoring', 'debugging', 'implementation'],
  tester: ['unit-testing', 'integration-testing', 'coverage', 'test-generation'],
  reviewer: ['code-review', 'security-audit', 'quality-check', 'best-practices'],
  researcher: ['web-search', 'documentation', 'analysis', 'summarization'],
  architect: ['system-design', 'architecture', 'patterns', 'scalability'],
  'backend-dev': ['api', 'database', 'server', 'authentication'],
  'frontend-dev': ['ui', 'react', 'css', 'components'],
  devops: ['ci-cd', 'docker', 'deployment', 'infrastructure'],
};

const TASK_PATTERNS = {
  'implement|create|build|add|write code': 'coder',
  'test|spec|coverage|unit test|integration': 'tester',
  'review|audit|check|validate|security': 'reviewer',
  'research|find|search|documentation|explore': 'researcher',
  'design|architect|structure|plan': 'architect',
  'api|endpoint|server|backend|database': 'backend-dev',
  'ui|frontend|component|react|css|style': 'frontend-dev',
  'deploy|docker|ci|cd|pipeline|infrastructure': 'devops',
};

function routeTask(task) {
  const taskLower = task.toLowerCase();

  for (const [pattern, agent] of Object.entries(TASK_PATTERNS)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(taskLower)) {
      return {
        agent,
        confidence: 0.8,
        reason: `Matched pattern: ${pattern}`,
      };
    }
  }

  return {
    agent: 'coder',
    confidence: 0.5,
    reason: 'Default routing - no specific pattern matched',
  };
}

// Lightweight stand-in for v3/@claude-flow/cli/src/ruvector/enhanced-model-router.ts.
// That module does the *real* 3-tier routing (deterministic codemod detection via
// the TS codemod engine, AST complexity on a target file, a Thompson-bandit model
// router) but only runs from the built CLI (`hooks pre-task`), which requires
// `dist/` to exist. This hook fires on every prompt with a hard timeout, so it
// can't shell out to a cold-start build — instead it approximates Tier 2/3 with
// pure keyword + length heuristics. It intentionally does NOT attempt Tier 1
// codemod detection: that requires actually applying the codemod to verify it's
// not a no-op, which needs the real engine — a fake [CODEMOD_AVAILABLE] here
// could recommend skipping the LLM for an edit that wouldn't apply.
const TIER3_KEYWORDS = [
  /\b(microservices?|architecture|system\s+design|distributed)\b/i,
  /\b(design|architect|plan)\s+(a|an|the|complex)\b/i,
  /\b(oauth2?|pkce|jwt|rbac|authentication\s+system|security\s+audit)\b/i,
  /\b(encryption|cryptograph|certificate|ssl|tls)\b/i,
  /\b(consensus|distributed|byzantine|raft|paxos)\b/i,
  /\b(replication|sharding|partitioning|eventual\s+consistency)\b/i,
  /\b(load\s+balanc|fault[- ]toleran|high\s+availability)\b/i,
  /\b(algorithm|machine\s+learning|neural|optimization)\b/i,
  /\b(schema\s+design|database\s+architect|data\s+model|multi[- ]tenant)\b/i,
  /\b(performance\s+critical|low\s+latency|high\s+throughput|concurrent)\b/i,
];

const MODEL_TIER_COSTS = {
  haiku: { estimatedLatencyMs: 500, estimatedCost: 0.0002 },
  sonnet: { estimatedLatencyMs: 2000, estimatedCost: 0.003 },
  opus: { estimatedLatencyMs: 5000, estimatedCost: 0.015 },
};

// CLAUDE.md's documented thresholds (ADR-026/143): <0.3 haiku, <0.6 sonnet, else opus.
const COMPLEXITY_THRESHOLDS = { haiku: 0.3, sonnet: 0.6 };

function estimateComplexity(task) {
  const words = task.trim().split(/\s+/).filter(Boolean).length;
  // Longer prompts tend to describe more involved work; caps at 0.4 alone.
  let complexity = Math.min(0.4, words / 120);

  let tier3Hits = 0;
  for (const pattern of TIER3_KEYWORDS) {
    if (pattern.test(task)) tier3Hits += 1;
  }
  // Any architectural/security keyword is a strong signal; multiple hits push toward opus.
  if (tier3Hits > 0) complexity += 0.35 + Math.min(0.3, (tier3Hits - 1) * 0.1);

  return { complexity: Math.min(1, complexity), tier3Hits };
}

function recommendModel(task) {
  const { complexity, tier3Hits } = estimateComplexity(task);
  const { haiku, sonnet } = COMPLEXITY_THRESHOLDS;

  let model;
  let reasoning;
  if (complexity < haiku) {
    model = 'haiku';
    reasoning = `Low complexity (${(complexity * 100).toFixed(0)}%) - using haiku`;
  } else if (complexity < sonnet) {
    model = 'sonnet';
    reasoning = `Medium complexity (${(complexity * 100).toFixed(0)}%) - using sonnet`;
  } else {
    model = 'opus';
    reasoning = tier3Hits > 0
      ? `High complexity (${(complexity * 100).toFixed(0)}%, ${tier3Hits} architectural/security keyword${tier3Hits === 1 ? '' : 's'}) - using opus`
      : `High complexity (${(complexity * 100).toFixed(0)}%) - using opus`;
  }

  return {
    tier: model === 'haiku' ? 2 : model === 'sonnet' ? 2 : 3,
    handler: model,
    model,
    complexity,
    reasoning,
    ...MODEL_TIER_COSTS[model],
  };
}

module.exports = {
  routeTask, AGENT_CAPABILITIES, TASK_PATTERNS, recommendModel, estimateComplexity,
};

// CLI - only run when executed directly
if (require.main === module) {
  const task = process.argv.slice(2).join(' ');
  if (task) {
    const result = routeTask(task);
    const modelResult = recommendModel(task);
    console.log(JSON.stringify({ ...result, modelRouting: modelResult }, null, 2));
  } else {
    console.log('Usage: router.js <task description>');
    console.log('\nAvailable agents:', Object.keys(AGENT_CAPABILITIES).join(', '));
  }
}
