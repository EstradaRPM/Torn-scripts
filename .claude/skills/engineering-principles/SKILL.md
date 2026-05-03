---
name: engineering-principles
description: Audit a plan, design, or piece of code against core engineering principles — avoiding complexity, small steps, deep modules, feedback-rate pacing. Use when about to start a task, reviewing a design, or the work feels too large or tangled.
---

# Engineering Principles

Apply these principles to every task, plan, review, or design decision. They are not guidelines — they are constraints. Check work against all of them before proceeding.

## The Principles

### 1. Avoid complexity

Complexity is anything in the structure of a system that makes it hard to understand and modify. It has two main forms:

- **Obscurity** — important information is not obvious. A reader has to dig to understand what something does, why, or what the side effects are.
- **Change amplification** — a simple change requires modifications in many places. A good design lets a single change propagate naturally; a complex one ripples.

Before adding anything — a new parameter, a new abstraction, a new file, a new concept — ask: does this make the system easier or harder to understand and modify? If harder, don't add it.

The symptom of complexity is always the same: you have to hold too many things in your head at once.

### 2. Always take small, deliberate steps

Never make several changes at once. Each step should:

- Do exactly one thing
- Leave the system in a working state
- Be verifiable on its own before the next step begins

"Small" means: if you had to explain the step in one sentence, you could. If you need a list, it's too big.

Deliberate means: you chose this step because it moves toward the goal, not because it was easy or nearby.

### 3. The rate of feedback is your speed limit

You cannot go faster than feedback allows. If you can't verify a change is correct, you have no basis for the next step.

Before starting any step, know the answer to: how will I know this worked? If the answer is "I'll check it later" or "it's hard to test," stop and find a faster feedback path first. Slow feedback forces guessing. Guessing creates bugs. Bugs create complexity.

Implication: prefer changes that are immediately verifiable over changes that must be checked end-to-end. Shorten feedback loops by design, not by assumption.

### 4. Never take on a task that's too big

A task is too big when:

- You can't hold the full change in your head at once
- You can't describe a clean intermediate state to stop at if something goes wrong
- The feedback loop spans the entire change rather than a piece of it

When a task feels large, decompose it first. Find the smallest change that is independently useful and verifiable. Do that. Then reassess.

If you can't decompose it, you don't understand it well enough yet. Understanding it is the first step.

### 5. The best modules are deep

A deep module has a simple interface and a lot of functionality behind it. It hides complexity from its callers.

A shallow module has an interface nearly as complex as its implementation. It leaks its internals. Callers have to know too much. Adding it added complexity rather than hiding it.

When designing a module, function, or abstraction:

- Push complexity inward, not outward
- Make the interface the smallest possible surface that still gives callers what they need
- A good interface lets the caller be ignorant of the implementation

The deletion test: if you deleted this module, would its complexity disappear (shallow, not earning its keep) or reappear in N different callers (deep, earning its keep)? Modules that pass the deletion test are the ones worth having.

---

## How to Apply This Skill

When invoked, do the following:

1. **Identify the current task or plan.** Ask the user to describe it if it isn't already clear.
2. **Check each principle in order.** For each one, state whether the plan passes or fails it, and why.
3. **If a principle is violated, propose a concrete fix** — a smaller step, a simpler interface, a way to shorten feedback, a decomposition.
4. **Do not proceed past a violation.** Fix it first, then re-check.

This is not a retrospective review. Apply these principles before and during work, not only after.
