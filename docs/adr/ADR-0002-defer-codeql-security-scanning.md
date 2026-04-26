# ADR-0002: Defer CodeQL Security Scanning

**Status:** Accepted  
**Date:** 2026-04-26  
**Deciders:** Piotr Nawrocki (CEO), devops-engineer agent

---

## Context

GitHub CodeQL provides automated security analysis for code repositories, identifying vulnerabilities
and security issues in JavaScript/TypeScript and Python code.

During Sprint 0 (TICKET-001: Bootstrap monorepo), we initially added
`.github/workflows/codeql.yml` to enable security scanning. However, CI checks revealed that:

1. **Code scanning is not enabled for this repository** — GitHub's security scanning features
   require a paid GitHub plan (Team, Enterprise) or the repository to be public
2. The repository is currently **private** and on the **GitHub Free plan**
3. CodeQL analysis jobs were failing with permission errors:
   ```
   Code scanning is not enabled for this repository.
   Please enable code scanning in the repository settings.
   ```

## Decision

We will **defer CodeQL security scanning** until one of the following occurs:

1. We upgrade to a paid GitHub plan (Team or Enterprise) that includes security features, OR
2. We open-source the repository (making it public), which enables free access to GitHub Advanced
   Security features including CodeQL

In the meantime:

- Remove `.github/workflows/codeql.yml` from the repository
- Document this decision in CLAUDE.md and README.md
- Continue with other security practices:
  - Manual security reviews during code review
  - Dependency scanning via `pnpm audit` and Dependabot (available on Free plan)
  - Pre-commit hooks for basic security patterns (to be added in TICKET-007)
  - OWASP top 10 awareness during development

## Consequences

### Positive

- **CI unblocked:** All Sprint 0 checks now pass, allowing TICKET-001 to proceed to merge
- **No false blockers:** Removes a CI check that cannot pass on our current GitHub plan
- **Clear path forward:** Decision documented and reversible when circumstances change

### Negative

- **Reduced automated security coverage:** We lose CodeQL's deep static analysis capabilities for
  JavaScript/TypeScript and Python code
- **Manual security burden:** Security reviews must be more thorough until automated scanning is
  available
- **Risk of missed vulnerabilities:** Some security issues that CodeQL would catch may slip through
  manual review

### Mitigations

1. **Sprint 1-2:** Add comprehensive ESLint security plugins (`eslint-plugin-security`,
   `eslint-plugin-no-unsanitized`) to catch common vulnerabilities
2. **Sprint 3:** Implement pre-commit secret scanning (TICKET-007: Doppler + secret patterns)
3. **Ongoing:** Run `pnpm audit` in CI to catch known vulnerabilities in dependencies
4. **Q2 2026:** Re-evaluate upgrading to GitHub Team plan once we have paying customers and revenue

## Alternatives Considered

### Alternative 1: Upgrade to GitHub Team plan immediately

- **Cost:** $4/user/month = $12/month for 3 founders
- **Pros:** Enables CodeQL now, includes other security features
- **Cons:** Adds recurring cost before product launch and revenue
- **Decision:** Deferred until revenue justifies the expense

### Alternative 2: Make the repository public

- **Cost:** Free
- **Pros:** Enables CodeQL and all GitHub Advanced Security features at no cost
- **Cons:**
  - Exposes proprietary business logic and AI/ML algorithms
  - Competitors could clone the approach before we launch
  - May complicate future commercialization or fundraising
- **Decision:** Rejected; the competitive advantage of keeping the codebase private outweighs the
  security benefits

### Alternative 3: Use a third-party security scanning tool

- **Examples:** Snyk, SonarCloud, Semgrep
- **Cost:** $0-99/month depending on tool and plan
- **Pros:** Security scanning without GitHub plan upgrade
- **Cons:** Another vendor integration, learning curve, potential cost
- **Decision:** Deferred; evaluate in Sprint 2-3 if manual reviews prove insufficient

## Related Decisions

- **ADR-0001** (implicit): Use GitHub for repository hosting and CI/CD
- **Future ADR:** Will be written when we decide to either upgrade GitHub plan or adopt alternative
  security tooling

## Review Trigger

This decision should be **re-evaluated** when:

1. We reach $5K MRR (enough to justify GitHub Team plan cost)
2. We experience a security incident that CodeQL would have prevented
3. We decide to open-source parts of the codebase
4. A free or low-cost alternative security tool proves superior to CodeQL

---

**Implementation:** TICKET-001 (Sprint 0)  
**Next Review:** Q2 2026 or upon reaching $5K MRR
