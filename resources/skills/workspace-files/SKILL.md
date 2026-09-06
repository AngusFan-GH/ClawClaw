---
name: Workspace Files
version: 1.0.0
description: Read approved text files and list directories inside the ClawCore workspace.
tools:
  - core.artifact.readText
  - core.fs.listDirectory
---
# Workspace Files

- Use `core.fs.listDirectory` to inspect a directory and `core.artifact.readText` to read a text file or staged artifact.
- Paths are confined to the workspace artifact root; `..` escapes are rejected.
- These tools require user approval. Report only what was read; never modify files.
