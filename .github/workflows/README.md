# GitHub Actions

This folder contains the following GitHub Actions:

- [CI][CI] - all CI jobs for the project
  - lints the code
  - `typecheck`s the code
  - runs test suite
  - runs on `ubuntu-latest`
- [Release][Release] - publishes tagged releases through Pantry
  - validates that the tag matches the workspace version
  - publishes packages to Pantry and npm
  - creates or updates the GitHub Release with the Pantry action
  - generates the release body from the tag range with Logsmith
  - attaches all native artifacts and Pantry-generated SHA-256 checksums
  - verifies the checksums, uploaded asset list, and release notes

[CI]: ./ci.yml
[Release]: ./release.yml
