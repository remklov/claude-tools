# 2 Understand

1. Read your brief completely: the spec, the packages, the procedures that apply, the knowledge-base duties.
2. `cw context --task <id>` lists the docs to read first, the procedures whose triggers match, and the rules for the affected paths (`cw rules show <ID>` prints one in full).
3. Read the docs and the code you are about to change before editing anything.
4. An acceptance criterion that is ambiguous or contradicts the code → stop and report `blocked` with the question. Never guess on the topics the brief lists under "Never guess on".
5. Before building something "new", check the project's feature register (if the brief names one) and grep the code.
