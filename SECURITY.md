# Security Policy

## Supported Version

Security fixes are provided for the latest version published on the VS Code Marketplace. Please reproduce an issue with the latest release before reporting it when possible.

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting page when it is available:

https://github.com/Beautiful-blue-sky/vscode-ssh-kit/security/advisories/new

If private reporting is unavailable, open a minimal GitHub issue asking for a private contact channel. Do not include host inventories, usernames, IP addresses, SSH Config contents, private keys, backup files, access tokens, or other credentials in a public issue.

Include the SSH Kit version, VS Code version, operating system, expected behavior, and a minimal reproduction with sensitive values replaced. Logs should be reviewed and redacted before sharing.

## Sensitive Data Boundaries

- SSH Kit stores host metadata in VS Code `globalState`.
- A complete SSH Kit backup contains associated private key contents. Store it in an encrypted or access-controlled location and remove it after use.
- The `sshKitHosts` language model tool is read-only. It never returns private key contents, and identity-file paths require explicit confirmation before sharing.
- Opening a private key file is an explicit local user action. SSH Kit does not transmit its contents.
