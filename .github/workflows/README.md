# GitHub Actions

This folder contains the following GitHub Actions:

- [CI][CI] - all CI jobs for the project
  - lints the code
  - `typecheck`s the code
  - runs test suite
  - runs on `ubuntu-latest`
- [Release][Release] - automates the release process & changelog generation

[CI]: ./workflows/ci.yml
[Release]: ./workflows/release.yml
