/**
 * Commitlint configuration for Estalara Adaptive Listings
 * Enforces Conventional Commits format from docs/CONVENTIONS.md
 *
 * Format: <type>(<scope>): <subject> [TICKET-XXX]
 * Example: feat(ingest): add event validation [TICKET-042]
 *
 * @type {import('@commitlint/types').UserConfig}
 */

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allowed types from CONVENTIONS.md
    'type-enum': [
      2,
      'always',
      [
        'feat', // New feature
        'fix', // Bug fix
        'chore', // Maintenance, deps, config
        'docs', // Documentation only
        'test', // Adding or refactoring tests
        'refactor', // Code restructuring without behavior change
        'perf', // Performance improvement
        'build', // Build system or external dependencies
        'ci', // CI/CD configuration
      ],
    ],

    // Scope is REQUIRED (module or area affected)
    'scope-empty': [2, 'never'],

    // Valid scopes from CONVENTIONS.md
    'scope-enum': [
      2,
      'always',
      [
        'sdk', // @estalara/sdk
        'ingest', // apps/ingest
        'control-plane', // apps/control-plane
        'decision-api', // apps/decision-api
        'intent', // apps/intent-engine
        'adapt', // apps/adaptation-engine
        'data', // data-engineer work
        'infra', // devops-engineer work
        'ci', // CI/CD workflow files
        'compliance', // compliance-engineer work
        'qa', // qa-engineer work
        'agents', // .claude/ agent definitions
        'deps', // dependency updates
        'repo', // repo-wide changes
        'pm', // pm-orchestrator queue/backlog updates
        'shared', // packages/shared
        'db', // packages/db
        'backlog', // backlog management only
      ],
    ],

    // Subject must be substantive (min 10 chars)
    'subject-min-length': [2, 'always', 10],

    // Subject should be concise (max 80 chars before ticket ref)
    'subject-max-length': [2, 'always', 120],

    // Subject must not end with period
    'subject-full-stop': [2, 'never', '.'],

    // Subject must be lowercase (conventional commits style)
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],

    // Body should be wrapped at 100 chars
    'body-max-line-length': [1, 'always', 100],

    // Footer should be wrapped at 100 chars
    'footer-max-line-length': [1, 'always', 100],
  },

  // Custom parser options
  parserPreset: {
    parserOpts: {
      // Allow [TICKET-XXX] suffix (not part of standard conventional commits)
      // This is validated separately in lefthook
      headerPattern: /^(\w+)(?:\(([^)]*)\))?: (.+)/,
      headerCorrespondence: ['type', 'scope', 'subject'],
    },
  },

  // Plugins for additional validation
  plugins: [
    {
      rules: {
        // Custom rule: ensure [TICKET-XXX] is present
        'ticket-reference': (parsed) => {
          const { subject } = parsed;
          if (!subject) {
            return [false, 'Subject is required'];
          }

          // Check for [TICKET-NNN], [TICKET-FIX-NNN], [TICKET-INFRA-NNN], [TICKET-DEMO-NNN],
          // [TICKET-ADM-NNN], [TICKET-QUIZ-NNN], [TICKET-DB-NNN], [TICKET-EMB-NNN],
          // [TICKET-ARCH-NNN], [TICKET-ADP-NNN], [TICKET-DQS-NNN], [TICKET-AUTO-NNN],
          // [TICKET-AB-NNN], [TICKET-REORDER-NNN], [TICKET-AGENCY-NNN],
          // [TICKET-GDPR-NNN], [TICKET-VAL-NNN], [TICKET-DESC-NNN], [TICKET-DESC-PIVOT-NNN],
          // [TICKET-CAUSAL-NNN], [TICKET-PROCESS-NNN], [TICKET-DECISIONS-NNN],
          // [TICKET-RLS-NNN], [TICKET-RUNTIME-AUDIT-NNN], or [ESCALATION] reference
          const ticketPattern =
            /\[TICKET-(?:FIX-|INFRA-|DEMO-|ADM-|QUIZ-|DB-|EMB-|ARCH-|ADP-|DQS-|AUTO-|AB-|REORDER-|AGENCY-|GDPR-|VAL-|DESC-PIVOT-|DESC-|CAUSAL-|PROCESS-|DECISIONS-|RLS-|RUNTIME-AUDIT-)?\d+[a-z]?\]|\[ESCALATION\]/;
          if (!ticketPattern.test(subject)) {
            return [
              false,
              'Commit message must include [TICKET-XXX] or [TICKET-PREFIX-XXX] reference (see CONVENTIONS.md). Example: feat(compliance): add DPIA [TICKET-GDPR-001]',
            ];
          }

          return [true];
        },
      },
    },
  ],

  // Enable custom rules
  rules: {
    'ticket-reference': [2, 'always'],
  },

  // Ignore certain commits
  ignores: [
    // Merge commits from GitHub
    (message) => message.startsWith('Merge '),
    // Revert commits
    (message) => message.startsWith('Revert '),
    // Initial commit
    (message) => message === 'Initial commit',
  ],

  // Help URL shown on errors
  helpUrl:
    'https://github.com/Estalara/adaptive-listings/blob/main/docs/CONVENTIONS.md#commit-messages-conventional-commits',
};
