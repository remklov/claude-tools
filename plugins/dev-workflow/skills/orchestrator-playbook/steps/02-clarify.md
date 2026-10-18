# O2 Clarify

1. Ask with AskUserQuestion until requirements and acceptance criteria are testable; at most `workflow.maxQuestionsPerRound` (default 4) questions per round.
2. If the user hasn't named a ticket, ask for it in the first round: offer matching open IDs, "New row" (you add one with `cw ticket new-row --section "<section>" --cells '<json>'`, which reserves the ID atomically) and "No ticket" (the profile's `noTicketKey`).
3. Never guess on the profile's `domain.neverGuess` topics: ask, or point to the plan, manual or source that settles it.
4. Ask about scope boundaries early (what is a non-goal) — they keep the implementer's diff small.
