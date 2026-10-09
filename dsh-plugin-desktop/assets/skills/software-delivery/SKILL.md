---
name: software-delivery
description: Turn a software request into a scoped, testable implementation. Use for architecture, coding, debugging, review, security engineering, testing, and production-readiness work.
---

# Software delivery

Establish current behavior before changing code. Inspect repository instructions, ownership boundaries, relevant implementation, existing tests, and the working tree. Preserve unrelated edits.

Define the smallest complete outcome:

1. User-visible behavior and acceptance conditions.
2. Interfaces, data flow, persistence, and compatibility constraints.
3. Failure, permission, cancellation, concurrency, and recovery paths.
4. Verification proportional to the affected surface.

Follow local patterns and reuse established services. Avoid speculative abstractions and broad refactors. Treat inputs, file paths, credentials, network responses, generated content, and plugin data as untrusted at their boundaries.

For asynchronous UI, ensure mutations update the authoritative snapshot and notify every consumer; remounting a page must not be required for correctness.

Verify focused tests first, then type checking or broader checks when shared contracts changed. Report what ran, what did not run, and residual risk. Do not state that a test passed unless its command completed successfully.
