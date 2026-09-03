# MyBridge Release Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the plan task-by-task.

**Goal:** Make the existing MyBridge V0.3 app distributable through GitHub Releases with a native Windows x64 NSIS installer and a macOS arm64 DMG, without changing the sync product core.

**Architecture:** Keep the Electron agent and renderer unchanged. Make Electron Builder targets and artifact names explicit per platform, build each platform on its native GitHub Actions runner, then use a release job to publish the two verified assets for `v*` tags. Update only user-facing installation documentation and repository release hygiene.

**Tech Stack:** Electron, Electron Builder, npm, GitHub Actions, GitHub CLI.

---

## Task 1: Make platform packaging explicit

- Add clear npm scripts for Windows x64 and macOS arm64 builds.
- Configure Windows targets as x64 NSIS plus optional x64 portable output.
- Configure macOS target as arm64 DMG.
- Set stable artifact names for the installer and DMG.
- Preserve the existing Electron entry point, agent, tray, startup, and sync code.

## Task 2: Add native GitHub Actions release workflow

- Create a workflow using `windows-latest` and `macos-latest` build jobs.
- Run `npm ci` and `npm test` before each platform build.
- Upload only the intended Windows installer and macOS DMG as release inputs.
- On `v*` tags, create a GitHub Release with `contents: write` and attach both assets.
- Keep manual workflow dispatch available for build checks without publishing a release.

## Task 3: Rewrite distribution documentation and repository hygiene

- Put ordinary-user download and installation instructions first in README.
- Explain unsigned Windows SmartScreen and macOS Gatekeeper handling for this development release.
- Move terminal/npm commands to the Development section.
- Replace personal filesystem examples with generic paths.
- Extend `.gitignore` for local configuration, secrets, logs, and generated packaging output.

## Task 4: Verify the delivery path

- Run the complete test suite.
- Build the macOS arm64 DMG locally and verify its name and output.
- Inspect the final diff and tracked files for personal paths, credentials, local config, and sync data.
- Confirm the workflow invokes native runners and the exact build scripts.
- Report the Windows real-machine acceptance steps and the tag-to-release flow.
