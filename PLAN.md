# Plan: dev-workflow-Marketplace `remklov/claude-tools`

Stand: 2026-10-18 · **Status: umsetzungsreif** (siehe §9) · Arbeitsdokument auf Deutsch. Die Detail-Spezifikationen unter `plan/spec/` sind Englisch, weil sie später 1:1 in `docs/` des Repos wandern.

## Dokumentenkarte

| Dokument | Inhalt |
|---|---|
| `PLAN.md` (dieses) | Entscheidungen, Zielbild, Architektur im Überblick, Meilensteine, Risiken, Umsetzungsreife |
| `plan/BACKLOG.md` | Alle Arbeitspakete WP-00 … WP-91 mit Abhängigkeiten, Größen und Abnahmekriterien |
| `plan/spec/00-spikes.md` | Phase 0: 13 Plattform-Spikes mit Prozedur, Kriterium und Plan B |
| `plan/spec/01-contracts.md` | Alle Datenformate: Profil, Pack, Regeldatei, Prozedur, Task-State, Spec, Report, Review, Lock |
| `plan/spec/02-cw-cli.md` | CLI `cw`: Konventionen, Module, jeder Befehl mit Verhalten und Exit-Codes |
| `plan/spec/03-rules-engine.md` | Regel-Layering, Anpassung, Scopes, kompilierte Ausgabe, Drift, `applicable` |
| `plan/spec/04-packs.md` | Basis-Packs mit jeder Regel (ID, Scope, Herkunft aus CQ-n), Prozeduren, Scripts, Guards |
| `plan/spec/05-roles-and-playbooks.md` | Agent-Matrix, Generator, Agent-Texte, jede Playbook-Datei mit Quelle, Einstiegs-Skills |
| `plan/spec/06-hooks.md` | Fünf Hooks mit Ein-/Ausgabe, Guard-Katalog, Ticket-Erkennung, Fehlerverhalten |
| `plan/spec/07-agents-progress.md` | Umbau der Mod: State-getrieben, Avatare nach Rolle/Area, Tests |
| `plan/spec/08-repo-ci-release.md` | Repo, Konventionen, CI-YAML, Release, Rechner-Setup (privat), savvy-Entfernung |
| `plan/spec/09-fisko-migration.md` | Vollständiges fisko-Profil, Projektregeln, Settings, AGENTS.md-Text, Pilot, Rollback |

---

## 1. Entscheidungen

| # | Entscheidung | Datum |
|---|---|---|
| E1 | Ein Marketplace `remklov` im Repo `remklov/claude-tools` mit den Plugins `dev-workflow` und `agents-progress` | 2026-10-18 |
| E2 | Repo ist **vorerst privat**; Lizenz MIT (wegen der savvy-progress-Anteile in der Mod ohnehin nötig) | 2026-10-18 |
| E3 | Urheber und Eigentümer aller übernommenen Workflow-Texte und der bestehenden Progress-Mod ist Benedikt Volkmer; die Übernahme ist geklärt | 2026-10-18 |
| E4 | **Keine Fable-Modelle** (brauchen Nutzungsguthaben). Der `investigator` läuft auf Opus 5.5 mit `xhigh`; Generator, CI und Guard verbieten Fable-IDs | 2026-10-18 |
| E5 | **savvy-flow und savvy-progress werden komplett entfernt** (alle Rechner, fisko). Benötigte Funktionen (geplante Tasks, Schritt-Fortschritt) baut `agents-progress` aus dem Workflow-State nach | 2026-10-18 |
| E6 | Ein Plugin mit Stack-Packs als Daten statt ein Plugin pro Stack | 2026-10-18 |
| E7 | Regeln werden ins Projekt kompiliert (`.claude/rules/workflow/`, eingecheckt, mit Lock) | 2026-10-18 |
| E8 | Einstieg über den Skill `/dev-workflow:ticket` in der Hauptsession; Agent-Modus `claude --agent dev-workflow:orchestrator` zusätzlich | 2026-10-18 |
| E9 | Modellmatrix: Sonnet 5.5 für s/m, Opus 5.5 für l/xl, Reviewer und Orchestrator; Investigator Opus 5.5 `xhigh` | 2026-10-18 |
| E10 | Task-State liegt im Git-Common-Dir (`.git/dev-workflow/`), geteilt über alle Worktrees, nie committet. Die Mod liest ihn direkt; kein Progress-Tool-Aufruf durch das Modell mehr nötig | 2026-10-18 |
| E11 | **„In Arbeit“ steht nie im versionierten Backlog.** Wer woran arbeitet, liegt in einer Claim-Registry: ein Ref `refs/claims/<ID>` pro Ticket auf `origin`, atomar angelegt per Push mit leerer Lease, sofort sichtbar für alle Sessions, Worktrees, Rechner und Cloud-Sessions. `NEXT_STEPS.MD` bleibt das Backlog (nur dauerhafte Zustände); neue IDs werden atomar reserviert; ein zeilenweiser Merge-Driver entschärft Tabellenkonflikte | 2026-10-18 |
| E12 | **Start per Satz:** In einer Orchestrator-Session genügt „starte mit Ticket XYZ“ oder „nimm das nächste Ticket“. Der erste Schritt ist automatisch `cw intake`, das den Claim setzt; ist das Ticket belegt, nennt der Orchestrator Inhaber, Rechner und Phase | 2026-10-18 |

## 2. Ausgangslage (kurz)

Zwei auseinandergelaufene Kopien desselben Workflows: `claude-workflow` (Express 5/React 19, In-place in `app/`, eigene Progress-Mod) und fisko (Express 4/React 18, Worktrees, `/ticket`-Skill, NEXT_STEPS-Integration, Knowledge-Base-Pflege, fiskalische Regeln, savvy-progress). Probleme: Drift, Stack in Agent-Prompts verdrahtet, 12 Agents (Typ × Größe), Mechanik als Prosa, nicht schichtbare CQ-Nummern, zwei Progress-Mods.

## 3. Zielbild

1. **Ein Workflow, jeder Stack.** Rollen und Ablauf sind stack-neutral. Stack-Wissen steckt in Packs, Projektwissen im Profil.
2. **Mechanik in Scripts, Urteil im Modell.** `cw` berechnet betroffene Pakete, Mindest-Komplexität, anwendbare Regeln, Branch-Namen, Prompts für Delegationen, Checks, Testbeweise, Commit-Format, Report-Validierung und PR-Body.
3. **Durchsetzen statt bitten.** Feste Agent-Frontmatter, Permissions, Guards, Stop-Validierung, Zustandsautomat.
4. **Feste Playbooks.** Eine Rolle, ein Playbook. Erweiterungen hängen sich nur an definierten Stellen ein (Prozeduren, Regeln, Optionen).
5. **Opt-in, inert ohne Profil.** Das Plugin darf überall aktiv sein; ohne `.claude/workflow/profile.json` tun die Hooks nichts.

## 4. Architektur im Überblick

```text
Projekt                        Plugin dev-workflow                        Plugin agents-progress
.claude/workflow/profile.json ─► cw (Node, ohne Abhängigkeiten)  ─writes─► .git/dev-workflow/state.json ─reads─► Pane + Band
.claude/workflow/rules|playbooks  agents/ (7, Matrix E9)
.claude/rules/workflow/*.md ◄──── skills/ ticket · setup · 4 Rollen-Playbooks
  (kompiliert, eingecheckt)       packs/ core, git-github, node-npm, typescript, express,
                                         react-vite, tailwind, vitest, postgres-sql, docker, github-actions
                                  hooks/ SessionStart · SubagentStart · SubagentStop · PreToolUse(Guard) · UserPromptSubmit(Ticket)
                                  Claims: refs/claims/<ID> auf origin ◄── cw intake / cw task … (für alle Sessions sichtbar)
```

**Rollen:** `orchestrator` (Hauptsession), `implementer-s|m|l|xl` (Worktree), `reviewer` (read-only, Mutationen über `cw mutate`), `investigator` (read-only, Ursachen und Optionen). Das Domänenwissen (Frontend/Backend/Infra) steckt in Packs und Projekt-Prozeduren; die Area steuert Prozeduren, Regeln und Avatar.

**Playbook pro Rolle** = vorgeladener Skill mit fester Schrittfolge (spec 05) + Pack- und Projekt-Prozeduren mit Trigger + `cw`-Befehle. Was ein Agent bekommt, zeigt `cw playbook show <rolle>`.

**Regeln** = `core` → Stack-Packs (mit Varianten, z. B. `express@4`/`@5`) → Projekt (`disable`/`override`/`extend`/`add`/`options`); sprechende IDs mit Aliases auf die alten `CQ-n`; `protected` für Security, Fiskalisches und Migrationen (spec 03, 04).

**Delegation ist deterministisch:** `cw task start` gibt `subagent_type`, `description` und `prompt` aus; der Orchestrator übergibt sie wörtlich. Briefs, Reports und Reviews liegen als Dateien im Task-Verzeichnis und überleben Kontext-Kompaktierung.

**Ablauf pro Task:** „starte mit Ticket NV-9“ → `cw intake NV-9` (atomarer Claim + Preflight; belegt → Inhaber nennen) → Klären → Spec (`cw spec lint`) → Klassifizieren (`cw classify`, Mindest-Komplexität aus Profil) → Bestätigen (l/xl) → `cw task start` → Implementer (9 Schritte, Schrittmarker automatisch) → Reviewer (max. 3 Runden, gleicher Agent per SendMessage) → `cw base-moved`, `cw pr body`, Push und PR nach Bestätigung → `cw task cleanup` → Bericht. Bei unklarer Ursache zuerst `investigator`.

## 5. Meilensteine

| Meilenstein | Inhalt | Abnahme |
|---|---|---|
| M0 Fundament | savvy entfernt, Repo privat, Spikes S1–S13, CI | `plan/spikes-results.md` vollständig, Specs angepasst, CI grün |
| M1 `cw`-Kern | Alle Befehle aus spec 02 | Unit- und Golden-Tests grün |
| M2 Workflow im Fixture | Agents, Playbooks, Hooks, Basis-Packs, Mapping-Test | Dry-Run eines s-Tasks bis PR-Body im Fixture; alle alten CQ-Regeln abgebildet |
| M3 Mod | State-getriebene Anzeige | Manuelle Abnahme in Terminal und Desktop |
| M4 fisko-Pilot | Migration, drei Tickets (s/m/l) | Pilot-Abnahme spec 09 §9 |
| M5 Zweiter Stack, Release | Python-Packs, v1.0.0 | Python-Projekt ohne Änderung an Agents/Playbooks/Hooks; Installationstest |

Details, Abhängigkeiten und Größen: `plan/BACKLOG.md`.

## 6. Installation in Projekten (Zielzustand)

1. Einmal pro Rechner: `gh auth login` und `gh auth setup-git` (privates Repo), Auto-Update für `remklov` einschalten.
2. Im Projekt: `/plugin marketplace add remklov/claude-tools`, `/plugin install dev-workflow@remklov` (+ `agents-progress@remklov`).
3. `/dev-workflow:setup`: erkennt den Stack, klärt offene Fragen, schreibt einen Profilvorschlag.
4. Im eigenen Terminal: `cw init --write --profile <datei>` (Profil, Settings-Merge, `.gitignore`, `.gitattributes` mit Merge-Driver, AGENTS.md/CLAUDE.md-Snippet, Regelwerk). Committen.
5. Arbeiten: `claude --agent dev-workflow:orchestrator` starten und „starte mit Ticket XYZ“ sagen (oder in jeder Session `/dev-workflow:ticket XYZ`).
6. Updates: `/plugin marketplace update remklov` (oder Auto-Update), dann `cw rules build` und den Regel-Diff committen.

## 7. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Plattform-Annahmen stimmen nicht (Preload, `bin/`, Hooks, Mod-Dateizugriff, Worktree-Optionen, eigene Refs auf GitHub) | Phase-0-Spikes mit Plan B je Annahme, bevor Code entsteht |
| Plattform ändert sich (Mods-API, Plugin-Agent-Einschränkungen) | Mindestversion 2.1.300 im Doctor, dünne Adapter, CI mit `claude plugin validate` |
| Claims hängen am Netz zum Remote | Lokaler Fallback-Claim (atomar auf dem Rechner) mit späterem Sync; Konflikte stoppen den Orchestrator mit klarer Meldung |
| Verwaiste Claims (Session abgestürzt) | `staleHours` + fehlender Remote-Branch → „stale“; Übernahme nur nach Bestätigung (`cw ticket steal`) |
| Kontextbudget | SKILL.md ≤ 200 Zeilen, Schritte bei Bedarf, Hook-Kontext ≤ 6 000 Zeichen, pfadgescopte Regeln, CI-Budgets |
| `cw` wird zu groß | Nur Mechanik, die Prosa ersetzt; Module klein; jede Funktion getestet |
| Guards blockieren legitime Arbeit | Begründung plus Alternative in jeder Ablehnung, Tests je Regel, Profil-Steuerung |
| Orchestrator im Skill-Modus kann technisch Dateien bearbeiten | Bewusst akzeptiert: Instruktion plus Agent-Modus mit `disallowedTools`; Reviewer prüft Scope |
| Plugin-Agents ignorieren `permissionMode` | Spike S8 legt die nötige Einstellung fest; `cw init` schreibt sie |
| Ohne Fable fehlt die stärkste Stufe für sehr schwere Probleme | Investigator mit Opus 5.5 `xhigh`, Trennung Verstehen/Umsetzen, Eskalation an den Owner nach drei Runden |
| Privates Repo blockiert Mitnutzer | Später: Repo öffentlich machen oder einzelne Personen einladen; für M0–M5 nicht relevant |

## 8. Offene Punkte (blockieren die Umsetzung nicht)

1. **Projekte im In-place-Modus** (z. B. das Anwendungsprojekt hinter `claude-workflow`): nach M5 möglich (`express@5`, `react-19`, `git-gitlab`-Pack). Wer mitarbeitet, braucht Zugriff auf das private Repo (siehe Risiken).
2. **Pilot-Tickets** (spec 09 §9): OPS-12, APP-2, NV-9 sind Kandidaten mit Stand heute; zum Pilotzeitpunkt durch gleichartige ersetzen, falls erledigt.
3. **Spike-Ergebnisse** können Mechanismen ändern (z. B. Fallback auf das Progress-Tool, Inline-Playbooks oder Claims über die GitHub-API statt über eigene Refs). Jeder Fall hat einen festgelegten Plan B.

## 9. Umsetzungsreife

**Bewertung: umsetzungsreif.** Begründung:

- **Vollständig spezifiziert** (direkt implementierbar): Datenkontrakte, `cw`-Befehle mit Verhalten und Exit-Codes, Regel-Engine, Hooks inkl. Guard-Katalog, Agent-Matrix und Generator, Repo/CI/Release, fisko-Profil, Settings, Dateiliste und Pilot.
- **Spezifiziert mit Quelle statt Volltext** (wird im Arbeitspaket aus vorhandenen Texten portiert): Regeltexte (je Regel ist die Herkunft `CQ-n` angegeben) und Playbook-Schritte (je Datei Inhalt und Quellabschnitt). Das ist Absicht, denn die Texte existieren bereits und werden nur verallgemeinert.
- **Bewusst vor dem Bau zu prüfen:** 13 Plattform-Annahmen in Phase 0 (spec 00), jede mit Plan B. Deshalb beginnt die Umsetzung mit WP-00, WP-01 und WP-02.

Erster Schritt der Umsetzung: WP-00 (savvy entfernen) und WP-01 (Repo anlegen), danach WP-02 (Spikes).
