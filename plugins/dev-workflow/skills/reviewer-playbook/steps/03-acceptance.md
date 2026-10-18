# R3 Acceptance criteria

1. For each acceptance criterion name the test or code that proves it. A criterion without proof is not met.
2. For each new or changed test: `cw mutate --task <id> --test <package>:<test file>[::<name>] --remove <source file>:<start>-<end>` removes the code the test covers in a scratch copy and runs the test. A surviving mutation is a blocking CORE-TEST-SPEC finding.
3. Check the implementer's proofs in the report against what the tests really assert.
