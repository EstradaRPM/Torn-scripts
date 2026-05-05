# Engineering Principles

Apply these as hard constraints on every task, plan, review, and design decision.

---

## 1. Avoid complexity

Complexity takes two forms:
- **Obscurity** — important information is not obvious; a reader has to dig to understand what something does or why.
- **Change amplification** — a simple change requires modifications in many places.

Before adding anything — a parameter, an abstraction, a file, a concept — ask: does this make the system easier or harder to understand and modify? If harder, don't add it. The symptom of complexity is always the same: you have to hold too many things in your head at once.

## 2. Always take small, deliberate steps

Never make several changes at once. Each step should do exactly one thing, leave the system in a working state, and be verifiable on its own before the next step begins. If you need a list to describe the step, it's too big.

## 3. The rate of feedback is your speed limit

Before starting any step, know: how will I know this worked? If the answer is "I'll check it later" or "it's hard to test," stop and find a faster feedback path first. Slow feedback forces guessing. Guessing creates bugs. Bugs create complexity.

## 4. Never take on a task that's too big

A task is too big when you can't hold the full change in your head, can't describe a clean intermediate state, or the feedback loop spans the entire change. Decompose first. Find the smallest change that is independently useful and verifiable. Do that. Then reassess. If you can't decompose it, you don't understand it well enough yet — understanding it is the first step.

## 5. The best modules are deep

A deep module has a simple interface and a lot of functionality behind it. A shallow module has an interface nearly as complex as its implementation — it leaks internals and adds complexity instead of hiding it. Push complexity inward, not outward. Make the interface the smallest surface that still gives callers what they need.

**Deletion test:** if you deleted this module, would its complexity disappear (shallow, not earning its keep) or reappear in N different callers (deep, earning its keep)? Only keep modules that pass.
