---
name: loop-limit
description: Stop a workflow loop after a maximum number of iterations.
argument-hint: <max-iterations>
---

# loop-limit

Common workflow skill for cycle workflows.

`$ARGUMENTS` format: `<max-iterations>`.

Place this node near the start of a loop. Circuit compares the current internal loop iteration with `<max-iterations>`.

- If the current iteration is less than or equal to `<max-iterations>`, the skill succeeds and the loop continues.
- If the current iteration is greater than `<max-iterations>`, the skill fails and stops the loop.
- `<max-iterations>` must be a positive integer.
