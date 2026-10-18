# Backlog: Arbeitspakete

Jedes Arbeitspaket (WP) ist ein Branch `wp-<nn>-<slug>` und ein PR (spec 08 §1.3). „Abnahme“ ist die Definition of Done, „Spec“ der Ort der Details. Größen: **S** = klein (eine fokussierte Sitzung), **M** = mittel, **L** = groß (mehrere Sitzungen). Status: ⬜ offen · 🔄 in Arbeit · ✅ erledigt.

## Übersicht und Meilensteine

| Meilenstein | Arbeitspakete | Ergebnis |
|---|---|---|
| **M0 Fundament** | WP-00 – WP-03, WP-10, WP-11 | savvy entfernt, Repo privat auf GitHub, Spikes entschieden, CI grün |
| **M1 `cw`-Kern** | WP-20 – WP-38 | Alle `cw`-Befehle aus spec 02 mit Tests |
| **M2 Workflow im Fixture** | WP-40 – WP-48, WP-50 – WP-57 | Agents, Playbooks, Hooks, Basis-Packs; Dry-Run in einem fisko-ähnlichen Fixture |
| **M3 Mod** | WP-60 – WP-63 | `agents-progress` liest den Workflow-State |
| **M4 fisko-Pilot** | WP-70 – WP-74 | fisko läuft produktiv mit dem Marketplace |
| **M5 Zweiter Stack und Release** | WP-80, WP-90 (WP-91 optional) | Python-Stack bewiesen, v1.0.0 |

Kritischer Pfad: WP-01 → WP-02 → WP-03 → WP-20 → WP-21 → WP-22 → WP-23 → WP-24 → WP-50 → (WP-51…56) → WP-48 → WP-71 → WP-73. Parallel möglich: WP-10/11 neben WP-02; WP-26–38 neben WP-24; WP-60–62 nach WP-26; WP-40–47 nach WP-33/34.

| WP | Titel | Größe | Abhängig von | Spec |
|---|---|---|---|---|
| WP-00 | savvy-Plugins entfernen | S | – | 08 §5 |
| WP-01 | Repo-Bootstrap (privat) | S | – | 08 §1 |
| WP-02 | Spike-Harness und Spikes S1–S13 | M | WP-01 | 00 |
| WP-03 | Spike-Ergebnisse in Specs und ADRs | S | WP-02 | 00 |
| WP-10 | Marketplace und Plugin-Skelette | S | WP-01 | 08 §1 |
| WP-11 | CI, repo-lint, prepush | S | WP-10 | 08 §2 |
| WP-20 | `cw`-Gerüst | M | WP-10 | 02 §1–2 |
| WP-21 | Basis-Bibliotheken | M | WP-20 | 02 §2, 03 §7 |
| WP-22 | Profil-Loader und Schema | M | WP-21 | 01 §1 |
| WP-23 | Pack-Loader und Schema | M | WP-22 | 01 §2 |
| WP-24 | Regel-Engine | L | WP-23 | 03 |
| WP-25 | Playbook-Resolver | M | WP-23 | 01 §4, 02 §3 |
| WP-26 | Task-Zustandsautomat | L | WP-22 | 01 §5 |
| WP-27 | Ticket-Adapter | M | WP-26 | 02 §4.5 |
| WP-28 | Spec und Klassifizierung | M | WP-25, WP-26 | 01 §6–7, 02 §4.1 |
| WP-29 | Briefs und Delegationsausgaben | M | WP-24, WP-28, WP-38 | 02 §4.1 |
| WP-30 | Workspace und Checks | L | WP-26 | 02 §4.2, §4.4 |
| WP-31 | prove und mutate | M | WP-30 | 02 §4.3 |
| WP-32 | Commit-Nachricht, git lint, fremde Commits | M | WP-26 | 02 §4.2, §5 |
| WP-33 | Reports, Reviews, Investigations | M | WP-24, WP-31, WP-32 | 01 §8–10, 02 §5 |
| WP-34 | Auslieferung und Aufräumen | M | WP-33 | 02 §4.1 |
| WP-35 | doctor | M | WP-24 | 02 §3 |
| WP-36 | init | L | WP-35, WP-51 | 02 §3 |
| WP-37 | Restliche Befehle | M | WP-30 | 02 §4.2, §6 |
| WP-38 | Claim-Registry, `cw intake`, ID-Reservierung, Merge-Driver | L | WP-26, WP-27 | 01 §5.4, 02 §4.7 |
| WP-40 | Generator und Agents | S | WP-03 | 05 §1 |
| WP-41 | implementer-playbook | M | WP-40, WP-33 | 05 §2.2 |
| WP-42 | reviewer-playbook | M | WP-40, WP-33 | 05 §2.3 |
| WP-43 | orchestrator-playbook | L | WP-40, WP-34, WP-38 | 05 §2.1, §3 |
| WP-44 | investigator-playbook | S | WP-40, WP-33 | 05 §2.4 |
| WP-45 | Einstiegs-Skills `ticket` und `setup` | S | WP-43, WP-36 | 05 §4 |
| WP-46 | Hooks session-start, subagent-start, ticket-intent | M | WP-35, WP-25, WP-38 | 06 §2–3, §6 |
| WP-47 | Hooks guard und subagent-stop | M | WP-33 | 06 §4–5 |
| WP-48 | End-to-End-Dry-Run im Fixture | M | WP-41 – WP-47, WP-50 – WP-56 | 05 §5 |
| WP-50 | Pack `core` | M | WP-24 | 04 |
| WP-51 | Packs `node-npm`, `typescript` | M | WP-50 | 04 |
| WP-52 | Pack `express` (4/5) | M | WP-50 | 04 |
| WP-53 | Packs `react-vite`, `tailwind`, `vitest` | M | WP-50 | 04 |
| WP-54 | Pack `postgres-sql` | M | WP-50 | 04 |
| WP-55 | Packs `docker`, `github-actions` | M | WP-50 | 04 |
| WP-56 | Pack `git-github` | S | WP-50 | 04 |
| WP-57 | Regel-Mapping-Test | S | WP-51 – WP-56 | 03 §8 |
| WP-60 | Mod umziehen und umbenennen | S | WP-10 | 07 §1 |
| WP-61 | Band und Pane aus dem State | M | WP-60, WP-26, WP-03 | 07 §2–4 |
| WP-62 | Avatare, Steps, geplante Tasks, fremde Claims | M | WP-61, WP-38 | 07 §3–5 |
| WP-63 | Manuelle Abnahme der Mod | S | WP-62, WP-48 | 07 §7 |
| WP-70 | fisko-Voraussetzungen (Owner) | S | WP-00 | 09 §1 |
| WP-71 | fisko-Overlay | M | WP-57, WP-70 | 09 §2–4 |
| WP-72 | fisko-Settings, .gitignore, AGENTS.md | S | WP-71 | 09 §5–8 |
| WP-73 | fisko-Pilot mit drei Tickets | L | WP-72, WP-63 | 09 §9 |
| WP-74 | Alt-Setup in fisko entfernen | S | WP-73 | 09 §8–9 |
| WP-80 | Python-Packs und zweiter Pilot | L | WP-74 | 04 „Later packs“ |
| WP-90 | Release 1.0.0 | M | WP-74 | 08 §3 |
| WP-91 | Playbook-Evals (optional) | M | WP-90 | – |

## Details

### M0 Fundament

**WP-00 savvy-Plugins entfernen** — Ziel: keine savvy-Komponenten mehr auf diesem Rechner und in fisko.
- Lieferumfang: Befehle und Settings-Änderungen aus spec 08 §5; fisko-Commit „Remove the savvy-progress permissions“ (NO-TICKET).
- Abnahme: `claude plugin list` ohne savvy; `~/.claude/settings.json` ohne `claude-kit`; fisko-Settings ohne `mcp__savvy-progress__*`; eine fisko-Session startet ohne Fehler.

**WP-01 Repo-Bootstrap** — Ziel: privates Repo mit Plan.
- Lieferumfang: lokale Begriffsliste `~/.config/claude-tools/forbidden-terms` anlegen (Owner), `git init`, README-Stub, LICENSE (MIT), `.gitignore`, vor dem ersten Commit `grep -i -f ~/.config/claude-tools/forbidden-terms -r .` ohne Treffer, `PLAN.md` und `plan/` committen, `gh repo create remklov/claude-tools --private`, Secret `FORBIDDEN_TERMS` setzen (`gh secret set FORBIDDEN_TERMS < ~/.config/claude-tools/forbidden-terms`), Push.
- Abnahme: Repo privat auf GitHub; `main` enthält den Plan; kein verbotener Begriff in Dateien, Pfaden oder Commit-Nachrichten.

**WP-02 Spike-Harness und Spikes** — Ziel: Plattform-Annahmen geklärt.
- Lieferumfang: `spikes/` laut spec 00, `plan/spikes-results.md` mit Urteil je Spike; manuelle Spikes (S2-Desktop, S6, S8) zusammen mit dem Owner; für S12 ein temporäres privates Test-Repo (nach Owner-OK anlegen und wieder löschen).
- Abnahme: S1–S13 haben ein Urteil mit Belegen (Befehl, Ausgabe, Version).

**WP-03 Spike-Ergebnisse einarbeiten** — Ziel: Specs spiegeln die Realität.
- Lieferumfang: für jeden gescheiterten Spike den Plan B in die betroffene Spec übernehmen; `docs/adr/001…005` (Single plugin with data packs, Compiled rules, Generalist roles, State in git common dir, State-driven progress mod).
- Abnahme: keine Spec verweist mehr auf einen offenen Spike.

**WP-10 Marketplace und Plugin-Skelette** — Lieferumfang: `marketplace.json` (spec 08 §1.2), `plugin.json` beider Plugins (Version `0.1.0`), leere Standard-Verzeichnisse, READMEs. Abnahme: `claude plugin validate --strict .` grün; lokal installierbar über einen `directory`-Marketplace.

**WP-11 CI** — Lieferumfang: `.github/workflows/ci.yml`, `tools/repo-lint.mjs` (inkl. `--terms`), `tools/prepush.sh`, `tools/install-hooks.sh`. Abnahme: CI läuft auf einem PR grün; repo-lint findet eine absichtlich eingebaute `fable`-Modell-ID, ein Fake-Token und einen Testbegriff aus einer temporären Begriffsliste (in Datei, Pfad und Commit-Nachricht).

### M1 `cw`-Kern

**WP-20 `cw`-Gerüst** — `cw.mjs`-Dispatcher, `args`, `out`, `proc`, `git`, Discovery (repoRoot, commonDir, mainCheckout, pluginRoot), `bin/cw`-Shim (oder Plan B aus S2), `cw help`, `cw version`, Exit-Codes. Abnahme: Unit-Tests für Parser, Exit-Codes und Discovery (auch aus einem Worktree heraus).

**WP-21 Basis-Bibliotheken** — `glob`, `schema` (JSON-Schema-Teilmenge), `template` (inkl. Template→Regex), `yaml-lite`, `fsx` (atomares Schreiben, Locks, Scratch-Kopie mit node_modules-Links). Abnahme: Tests inkl. aller Globs der Basis-Packs, Lock-Konkurrenz zweier Prozesse, Scratch-Kopie mit verlinkten `node_modules`.

**WP-22 Profil** — `schemas/profile.schema.json`, Loader mit Defaults, `cw profile show|validate`, package-of-file, Guards-Merge. Abnahme: das fisko-Profil aus spec 09 validiert; 10 negative Fixtures liefern verständliche Fehler.

**WP-23 Packs** — `schemas/pack.schema.json`, Auflösung (lokal vor Plugin), `requires`/`conflicts`, Varianten, Optionen, `detect`. Abnahme: Tests mit Dummy-Packs für jede Regel.

**WP-24 Regel-Engine** — spec 03 vollständig: Parser, Layering, Customization, Scopes, Ausgabe-Dateien, Lock, `--check`, `applicable`, `show`, `list`. Abnahme: Golden-Test mit fisko-Fixture-Profil und Dummy-Packs; alle Fehlerfälle aus spec 03 §1.

**WP-25 Playbook-Resolver** — Prozedur-Frontmatter, `when`-Auswertung, `cw playbook show`. Abnahme: Tests für Shadowing, Varianten-Filter, Trigger.

**WP-26 Task-Zustandsautomat** — `task.json`, `state.json`, Locks, alle Übergänge aus spec 01 §5.3, `cw task new|show|list|phase|confirm|agent|end`. Abnahme: Test je erlaubtem und verbotenem Übergang; parallele Schreiber.

**WP-27 Ticket-Adapter** — `markdown-table` (mit Kopie von fisko-`NEXT_STEPS.MD` als Fixture), `github-issues`, `none`; kein Adapter speichert „in Arbeit“. Abnahme: list/show/dependencies/done/exists/newRow auf der Fixture.

**WP-28 Spec und Klassifizierung** — `cw task new` (Template), `cw spec lint` (alle Regeln aus spec 01 §6), `cw classify` (inkl. `--set`, `--override`). Abnahme: Lint-Fixtures; Klassifizierung der drei Pilot-Tickets im fisko-Fixture liefert die erwarteten Pakete und Mindest-Komplexitäten.

**WP-29 Briefs und Delegationsausgaben** — `brief-*.md`-Rendering; `cw task start|review|return|investigate` geben `agent`, `description`, `prompt` bzw. SendMessage-Text aus. Abnahme: Golden-Files für die drei Rollen.

**WP-30 Workspace und Checks** — `cw ws setup` (Worktree- und In-place-Modus), `cw checks` mit Services, exklusiven Locks, Logs, Timeouts. Abnahme: Tests mit Fake-Befehlen, Service-Start/-Stopp-Stubs, Lock-Wartezeit.

**WP-31 prove und mutate** — Abnahme: Fixture mit echtem `node --test`-Test; `prove` zeigt Fehlschlag ohne und Erfolg mit Änderung; `mutate` erkennt einen überlebenden Test.

**WP-32 Commit und git lint** — `cw commit msg`, `cw git lint`, `cw git foreign-commits`. Abnahme: fisko-Konventionen und Keyword-/Trailer-Konventionen als Fixture-Profile; Umbruch-Tests (Listen, URLs, Code).

**WP-33 Reports, Reviews, Investigations** — `cw report save`, `cw review scope|save`, `cw investigation save`, Schemas, semantische Validierung. Abnahme: valide und invalide Beispiele je Art; `rulesChecked` muss der applicable-Menge entsprechen.

**WP-34 Auslieferung und Aufräumen** — `cw base-moved`, `cw pr title|body|record`, `cw task cleanup`. Abnahme: base-moved mit und ohne Konflikt; PR-Body für das fisko-Profil als Golden-File; Cleanup verweigert bei Abweichung von `origin/<branch>`.

**WP-35 doctor** — alle Checks aus spec 02 §3, Cache, `--hook`-Ausgabe. Abnahme: Tests mit simulierten Fehlern (fehlender Symlink-Pfad, savvy aktiviert, veraltetes Regelwerk).

**WP-36 init** — `--detect` und `--write` (Settings-Merge, `.gitignore`, Snippet, `rules build`). Abnahme: fisko-Fixture → Profilvorschlag nahe spec 09; Merge erhält fremde Keys; Secret-Scan-Test gegen eine Fixture-`settings.local.json`.

**WP-37 Restliche Befehle** — `cw run`, `cw deps where`, `cw kb check`, `cw step`, `cw context`, `cw agents eject`. Abnahme: je ein Test.

**WP-38 Claim-Registry** — `lib/claims.mjs` (Backends `git-ref` und `local`, Offline-Fallback mit späterem Sync), `cw intake <id>|--next`, `cw ticket list --available|claims|claim|release|steal|gc|reserve-id|migrate-status`, Claim-Update bei jedem `cw task`-Übergang, Merge-Driver `ticket-table` inkl. Registrierung durch `cw init` und Doctor-Check. Abnahme: Tests aus spec 02 §7 (Wettlauf zweier Prozesse gegen ein Bare-Repo: genau ein Gewinner; veraltete Leases scheitern; `--next` überspringt Belegtes und Blockiertes; gc nach Merge; Merge-Driver-Fixtures mit benachbarten Löschungen).

### M2 Workflow im Fixture

**WP-40 Generator und Agents** — `tools/generate-agents.mjs` (Matrix aus spec 05 §1.1, kein Fable), vier generierte und drei handgeschriebene Agents. Abnahme: `--check` grün; repo-lint findet keine ignorierten Plugin-Felder.

**WP-41 / WP-42 / WP-43 / WP-44 Playbooks** — Dateien laut spec 05 §2 aus den angegebenen Quellen portiert und verallgemeinert. Abnahme je WP: alle Dateien vorhanden, Budgets eingehalten, jeder Schritt nennt seinen `cw`-Befehl, keine Projektnamen (z. B. fisko) im Text.

**WP-45 Einstiegs-Skills** — `ticket`, `setup` laut spec 05 §3. Abnahme: beide erscheinen als `/dev-workflow:ticket` und `/dev-workflow:setup`.

**WP-46 / WP-47 Hooks** — laut spec 06, inkl. `ticket-intent` (Satz „starte mit Ticket XYZ“ in einer Orchestrator-Session → erster Befehl `cw intake XYZ`). Abnahme: stdin-Fixture-Tests für jeden Hook; Guard-Katalog vollständig getestet; 20 deutsche und englische Formulierungen für `ticket-intent`; No-op ohne Profil bewiesen.

**WP-48 End-to-End-Dry-Run** — Fixture „fisko-mini“ (zwei Pakete, Migrationsverzeichnis, NEXT_STEPS-Kopie, Workflow-Dateien), ein s-Task über `/dev-workflow:ticket` bis `cw pr body` (ohne Push). Abnahme: Protokoll in `plan/dry-run.md`; alle Artefakte im Task-Verzeichnis valide.

**WP-50 – WP-56 Packs** — Inhalte laut spec 04. Abnahme je Pack: `pack.json` valide, Regeln mit Aliases kompiliert, Prozeduren vorhanden, Scripts mit Tests, Doctor-Checks mit Tests.

**WP-57 Regel-Mapping-Test** — CQ-1…28 (fisko) und CQ-1…23 (Regelwerk von `claude-workflow` über ein Fixture-Profil mit `express@5`, `react-19`) haben Nachfolger. Abnahme: Test in CI.

### M3 Mod

**WP-60** — bestehende Progress-Mod aus `claude-workflow/plugins/` ohne Git-Historie übernehmen, **vor dem ersten Commit** umbenennen und alle Bezüge auf den früheren Projektkontext entfernen (der Begriffs-Check aus WP-11 muss grün sein), Tests grün. **WP-61** — State-Quelle laut spec 07 §2 (oder Plan B aus S6), Tool entfernen, Band und Pane anpassen. **WP-62** — Avatare, Scientist-Kostüm, Steps, Planned-Bereich. **WP-63** — manuelle Abnahme Terminal und Desktop laut spec 07 §7.

### M4 fisko-Pilot

**WP-70** — P1–P6 aus spec 09 §1 (Owner, unterstützt; P6 = bestehende 🔄-Zeilen in Claims überführen oder zurücksetzen). **WP-71** — Profil, Projektregeln, Overrides, Prozeduren laut spec 09 §2–4 im Branch `chore-dev-workflow-migration`. **WP-72** — Settings, `.gitignore`, `.gitattributes` (Merge-Driver), AGENTS.md, Regeltext in `plan/NEXT_STEPS.MD`, `cw rules build`, Abgleich CQ-1…28. **WP-73** — Claim-Wettlauftest mit zwei Sessions, drei Pilot-Tickets per „starte mit Ticket …“ in Orchestrator-Sessions, Messprotokoll `plan/pilot-fisko.md`, Pilot-Abnahme laut spec 09 §9. **WP-74** — Alt-Dateien löschen, `/ticket-legacy` entfernen, GitHub-Marketplace als Quelle.

### M5 Zweiter Stack und Release

**WP-80** — Packs `python`, `fastapi`, `postgres-sql@alembic`; Pilot in tradarr oder stockmonitor mit einem m-Ticket. Abnahme: läuft ohne Änderung an Agents, Playbooks oder Hooks. **WP-90** — Doku in `docs/` (Englisch), CHANGELOG, Versionen `1.0.0`, `claude plugin tag --push`, Installationstest in einem frischen Projekt laut spec 08 §4. **WP-91** — optional: `evals/` mit Fällen „Reviewer findet eingebauten TS-NO-CAST-Verstoß“, „Implementer meldet misclassified bei Schema-Änderung in s“.
