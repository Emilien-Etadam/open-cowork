# Security Policy

## Supported Versions

| Version                              | Supported                   |
| ------------------------------------ | --------------------------- |
| `3.3.1-EE4.x` (latest EE release)    | Yes                         |
| Older `EE*` builds                   | Best effort                 |
| Upstream `3.3.x` without `EE` suffix | Not maintained in this fork |

Security fixes are published as new `EE*` releases on [GitHub Releases](https://github.com/Emilien-Etadam/open-cowork/releases).

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues through a [GitHub Private Vulnerability Report](https://github.com/Emilien-Etadam/open-cowork/security/advisories/new) on this fork.

Include:

- A clear description of the vulnerability
- Steps to reproduce or a proof-of-concept
- Affected version(s) (e.g. `3.3.1-EE4.97`)
- Potential impact assessment

### What to expect

- **Acknowledgement**: within 7 days
- **Status update**: within 14 days
- **Fix timeline**: critical issues targeted as soon as possible; others evaluated case-by-case

We will coordinate disclosure timing with you and credit reporters in the release notes unless you prefer to remain anonymous.

For upstream Open Cowork vulnerabilities that also affect this fork, you may additionally report to [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork/security).

## Scope

In scope for this fork:

- Electron main process privilege escalation
- Arbitrary code execution via crafted input (prompts, skills, MCP, plugins)
- Credential / API key leakage
- Sandbox escape (Lima / WSL2 isolation)
- **Chat LAN** token exposure or unauthorized access to the local web UI
- **Marketplace** install path: malicious curated entries, path traversal, zip-slip
- **Auto-update** channel tampering (Windows `latest.yml` / installer integrity)

Out of scope:

- Issues requiring physical access to a running machine
- Self-XSS or issues requiring the attacker to already have local code execution
- Vulnerabilities in third-party AI model APIs (report to the provider)
- Upstream-only features not present in this fork

## Security Best Practices for Users

- Install builds from [official EE releases](https://github.com/Emilien-Etadam/open-cowork/releases) only.
- Keep the app updated (`Réglages → Général → Vérifier les mises à jour` on Windows/macOS).
- Store API keys only in the built-in settings — never in plain text files in your workspace.
- Review marketplace extensions before installing; MCP stdio servers run local code.
- Disable **Chat LAN** when not needed; regenerate the token if it may have leaked.
- Enable sandbox isolation when running untrusted agent operations.
