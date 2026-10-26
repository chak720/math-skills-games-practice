import { useEffect, useMemo, useRef, useState } from "react";
import { answerText, checkAnswer } from "@/training/puzzles/answer";
import {
  annotateExplanation,
  getHistory,
  getLevels,
  levelTier,
  recordResult,
  techniqueSummary,
  type Filter,
  type PuzzleAttempt,
  type TierChoice,
} from "@/training/puzzles/scheduler";
import { TECHNIQUES } from "@/training/puzzles/techniques";
import { ALL_GENERATORS } from "@/training/puzzles/registry";
import {
  CATEGORY_LABEL,
  TIER_LABEL,
  type Category,
  type TechniqueId,
} from "@/training/puzzles/types";
import { fromWire, toWire, type WirePuzzle } from "@/training/puzzles/wire";
import {
  Badge,
  Button,
  cx,
  EmptyState,
  fmtClock,
  Kbd,
  Panel,
  ProgressBar,
  Segmented,
  Tabs,
  Toggle,
} from "../../components/core";
import {
  useHotkeys,
  useNow,
  usePersistent,
  useStorageVersion,
} from "../../hooks";
import { navigate, useRoute } from "../../router";
import { nextPuzzle } from "./next";

const TABS = [
  { value: "solve", label: "Solve" },
  { value: "history", label: "History" },
  { value: "techniques", label: "Techniques" },
] as const;

const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
const TIER_TARGET_MS = {
  warmup: 3 * 60_000,
  interview: 6 * 60_000,
  hard: 12 * 60_000,
};
const MIN_EXPLANATION = 40;

interface Prefs {
  category: Category | "any";
  tier: TierChoice;
  focus: Filter["focus"];
  timer: boolean;
  interviewer: boolean;
}
const DEFAULT_PREFS: Prefs = {
  category: "any",
  tier: "adaptive",
  focus: "mixed",
  timer: true,
  interviewer: false,
};

interface Current {
  puzzle: WirePuzzle;
  reason: string;
  technique?: TechniqueId;
  startedAt: number;
  hints: number;
  misses: number;
  status: "solving" | "solved" | "revealed";
  explanation: string;
  interviewer: boolean;
  lastWrong?: string;
  finishedMs?: number;
  /** Timestamp of the recorded attempt, to attach the self-assessment to. */
  recordedAt?: number;
  explained?: PuzzleAttempt["explained"];
}

export default function PuzzlesPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? "solve";
  const [technique, setTechnique] = useState<TechniqueId | undefined>(
    undefined,
  );
  return (
    <div>
      <h1 className="text-2xl mb-2">Puzzles</h1>
      <Tabs
        value={tab}
        onChange={(v) => navigate(v === "solve" ? "/puzzles" : `/puzzles/${v}`)}
        tabs={TABS}
      />
      {tab === "solve" && (
        <Solve
          technique={technique}
          clearTechnique={() => setTechnique(undefined)}
        />
      )}
      {tab === "history" && <History />}
      {tab === "techniques" && (
        <Techniques
          onPractise={(t) => (setTechnique(t), navigate("/puzzles"))}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ solve

function Solve({
  technique,
  clearTechnique,
}: {
  technique?: TechniqueId;
  clearTechnique: () => void;
}): JSX.Element {
  const [prefs, setPrefs] = usePersistent<Prefs>(
    "puzzles.prefs",
    DEFAULT_PREFS,
  );
  const [cur, setCur] = usePersistent<Current | null>("puzzles.current", null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState<string | null>(null);
  const lastTech = useRef(technique);

  const load = async (tech = technique): Promise<void> => {
    setLoading(true);
    setEmpty(null);
    try {
      const r = await nextPuzzle({
        category: prefs.category,
        tier: prefs.tier,
        focus: prefs.focus,
        technique: tech,
      });
      if (!r.puzzle) {
        setEmpty(r.reason);
        setCur(null);
      } else
        setCur({
          puzzle: toWire(r.puzzle),
          reason: r.reason,
          technique: tech,
          startedAt: Date.now(),
          hints: 0,
          misses: 0,
          status: "solving",
          explanation: "",
          interviewer: prefs.interviewer,
        });
    } finally {
      setLoading(false);
    }
  };

  // Arriving from "Practise this technique" starts a fresh puzzle for it.
  useEffect(() => {
    if (technique && technique !== lastTech.current) void load(technique);
    else if (technique && (!cur || cur.technique !== technique))
      void load(technique);
    lastTech.current = technique;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technique]);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]): void =>
    setPrefs({ ...prefs, [k]: v });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="label">Category</div>
          <Segmented
            size="sm"
            label="Category"
            value={prefs.category}
            onChange={(v) => set("category", v)}
            options={[
              { value: "any" as const, label: "All" },
              ...CATEGORIES.map((c) => ({
                value: c,
                label: CATEGORY_LABEL[c]
                  .replace(" & random walks", "")
                  .replace("Expected-value games", "EV games"),
              })),
            ]}
          />
        </div>
        <div>
          <div className="label">Difficulty</div>
          <Segmented
            size="sm"
            label="Difficulty"
            value={prefs.tier}
            onChange={(v) => set("tier", v)}
            options={[
              {
                value: "adaptive" as const,
                label: "Adaptive",
                title: "Moves up as you solve cleanly, down when you miss",
              },
              { value: "warmup" as const, label: "Warm-up" },
              { value: "interview" as const, label: "Interview" },
              { value: "hard" as const, label: "Hard" },
            ]}
          />
        </div>
        <div>
          <div className="label">Focus</div>
          <Segmented
            size="sm"
            label="Focus"
            value={prefs.focus}
            onChange={(v) => set("focus", v)}
            options={[
              { value: "mixed" as const, label: "Mixed" },
              {
                value: "review" as const,
                label: "Weak techniques",
                title: "Favour techniques you missed or needed hints for",
              },
            ]}
          />
        </div>
        <div className="flex gap-5 pb-1">
          <Toggle
            checked={prefs.timer}
            onChange={(v) => set("timer", v)}
            label="Timer"
          />
          <Toggle
            checked={prefs.interviewer}
            onChange={(v) => set("interviewer", v)}
            label="Interviewer mode"
          />
        </div>
      </div>
      {technique && (
        <div className="flex items-center gap-3 text-sm">
          <Badge tone="info">Only: {TECHNIQUES[technique].name}</Badge>
          <button
            type="button"
            className="text-paper-muted hover:text-paper underline underline-offset-2"
            onClick={clearTechnique}
          >
            Show all techniques
          </button>
        </div>
      )}
      {empty && <EmptyState title="Nothing new to show">{empty}</EmptyState>}
      {!cur && !empty && (
        <EmptyState
          title="Ready when you are"
          action={
            <Button
              variant="primary"
              onClick={() => void load()}
              disabled={loading}
              kbd="N"
            >
              {loading ? "Generating…" : "New puzzle"}
            </Button>
          }
        >
          Every puzzle is generated fresh, solved two independent ways, and
          never shown to you twice.
        </EmptyState>
      )}
      {cur && (
        <PuzzleCard
          key={cur.puzzle.id}
          cur={cur}
          setCur={setCur}
          timer={prefs.timer}
          loading={loading}
          onNext={() => void load()}
        />
      )}
      {!cur && <HotkeyNext onNext={() => void load()} enabled={!loading} />}
    </div>
  );
}

function HotkeyNext({
  onNext,
  enabled,
}: {
  onNext: () => void;
  enabled: boolean;
}): null {
  useHotkeys({ n: onNext }, enabled);
  return null;
}

function Prompt({ text }: { text: string }): JSX.Element {
  return (
    <div className="prose-math max-w-[72ch]">
      {text.split("\n\n").map((para, i) =>
        para.split("\n").every((l) => l.startsWith("    ")) ? (
          <pre
            key={i}
            className="font-mono text-[14px] leading-6 bg-ink-raised/60 border border-ink-line rounded px-4 py-3 my-3 overflow-x-auto"
          >
            {para
              .split("\n")
              .map((l) => l.slice(4))
              .join("\n")}
          </pre>
        ) : (
          <p key={i}>{para}</p>
        ),
      )}
    </div>
  );
}

function PuzzleCard({
  cur,
  setCur,
  timer,
  loading,
  onNext,
}: {
  cur: Current;
  setCur: (c: Current) => void;
  timer: boolean;
  loading: boolean;
  onNext: () => void;
}): JSX.Element {
  const p = useMemo(() => fromWire(cur.puzzle), [cur.puzzle]);
  const [input, setInput] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const done = cur.status !== "solving";
  const now = useNow(500, !done && timer);
  const elapsed = done ? (cur.finishedMs ?? 0) : now - cur.startedAt;
  const target = TIER_TARGET_MS[p.tier];
  const explanationOk =
    !cur.interviewer || cur.explanation.trim().length >= MIN_EXPLANATION;
  const inputRef = useRef<HTMLInputElement>(null);

  const finish = (
    status: "solved" | "revealed",
    extra: Partial<Current> = {},
  ): void => {
    const ms = Date.now() - cur.startedAt;
    const misses = extra.misses ?? cur.misses;
    const rec = recordResult(p, {
      correct: status === "solved",
      misses,
      hintsUsed: cur.hints,
      revealed: status === "revealed",
      ms,
      interviewer: cur.interviewer,
    });
    setCur({ ...cur, ...extra, status, finishedMs: ms, recordedAt: rec.t });
  };

  const submit = (): void => {
    if (done || !explanationOk) return;
    const raw = p.answer.kind === "choice" ? choice : input;
    if (raw === null || String(raw).trim() === "") return;
    const r = checkAnswer(p.answer, raw);
    if (r.correct) {
      setNote(r.note ?? null);
      finish("solved");
    } else {
      setNote(r.note ?? null);
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setCur({
        ...cur,
        misses: cur.misses + 1,
        lastWrong: String(
          p.answer.kind === "choice" ? p.answer.options[Number(raw)] : raw,
        ),
      });
      inputRef.current?.select();
    }
  };
  const hint = (): void => {
    if (!done && cur.hints < 3) setCur({ ...cur, hints: cur.hints + 1 });
  };
  const reveal = (): void => {
    if (!done) finish("revealed");
  };

  useHotkeys(
    {
      Enter: () => (done ? !loading && onNext() : submit()),
      h: hint,
      n: () => done && !loading && onNext(),
    },
    true,
    ["Enter"],
  );
  useHotkeys(
    Object.fromEntries(
      (p.answer.kind === "choice" ? p.answer.options : [])
        .slice(0, 9)
        .map((_, i) => [String(i + 1), () => !done && setChoice(i)]),
    ),
    p.answer.kind === "choice" && !done,
  );

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        <div className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 mb-1 text-sm">
            <Badge>{CATEGORY_LABEL[p.category]}</Badge>
            <Badge
              tone={
                p.tier === "hard"
                  ? "neg"
                  : p.tier === "interview"
                    ? "signal"
                    : "neutral"
              }
            >
              {TIER_LABEL[p.tier]}
            </Badge>
            {done && <span className="text-paper-muted">{p.title}</span>}
            {timer && (
              <span
                className={cx(
                  "ml-auto num",
                  !done && elapsed > target ? "text-ask" : "text-paper-muted",
                )}
                title={`Target for this tier: ${fmtClock(target)}`}
              >
                {fmtClock(elapsed)}
                <span className="text-paper-dim"> / {fmtClock(target)}</span>
              </span>
            )}
          </div>
          <Prompt text={p.prompt} />
          <div className="text-sm text-paper-muted mt-1">{p.ask}</div>

          {cur.interviewer && !done && (
            <div className="mt-5">
              <label className="label" htmlFor="explain">
                Explain your approach first, as you would out loud
              </label>
              <textarea
                id="explain"
                className="input w-full min-h-[96px] font-serif text-[16px] leading-relaxed"
                value={cur.explanation}
                onChange={(e) =>
                  setCur({ ...cur, explanation: e.target.value })
                }
                placeholder="State the method, the key equation, and how you would sanity-check the answer."
              />
              {!explanationOk && (
                <div className="text-xs text-paper-dim mt-1">
                  {MIN_EXPLANATION - cur.explanation.trim().length} more
                  characters to unlock the answer box.
                </div>
              )}
            </div>
          )}

          {!done && (
            <div className={cx("mt-5", shake && "animate-shake")}>
              {p.answer.kind === "choice" ? (
                <div
                  role="radiogroup"
                  aria-label="Answer"
                  className="flex flex-wrap gap-2"
                >
                  {p.answer.options.map((o, i) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={choice === i}
                      disabled={!explanationOk}
                      onClick={() => setChoice(i)}
                      className={cx(
                        "h-10 px-4 rounded border transition-colors",
                        choice === i
                          ? "border-signal bg-signal/15 text-paper"
                          : "border-ink-line text-paper-muted hover:text-paper hover:border-ink-strong",
                      )}
                    >
                      <span className="text-paper-dim mr-2 num">{i + 1}</span>
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  <label className="label" htmlFor="answer">
                    Your answer
                  </label>
                  <input
                    id="answer"
                    ref={inputRef}
                    autoFocus={!cur.interviewer}
                    autoComplete="off"
                    disabled={!explanationOk}
                    className="input w-full max-w-sm num text-md"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      p.answer.kind === "set"
                        ? "e.g. AC or none"
                        : p.answer.kind === "integer"
                          ? "a whole number"
                          : "e.g. 3/8, 0.375 or 37.5%"
                    }
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={!explanationOk}
                  kbd="↵"
                >
                  Check answer
                </Button>
                <Button onClick={hint} disabled={cur.hints >= 3} kbd="H">
                  {cur.interviewer ? "Ask for a nudge" : "Hint"}{" "}
                  {cur.hints > 0 && `(${cur.hints}/3)`}
                </Button>
                <Button variant="ghost" onClick={reveal}>
                  Show solution
                </Button>
                {cur.misses > 0 && (
                  <span className="text-sm text-ask" role="status">
                    {cur.lastWrong} is not right
                    {cur.misses > 1 ? ` (${cur.misses} tries)` : ""}.
                    {note ? ` ${note}` : ""}
                  </span>
                )}
                {cur.misses === 0 && note && (
                  <span className="text-sm text-paper-muted">{note}</span>
                )}
              </div>
            </div>
          )}

          {cur.hints > 0 && (
            <ol className="mt-5 space-y-2">
              {p.hints.slice(0, cur.hints).map((h, i) => (
                <li key={i} className="flex gap-3 text-paper-muted">
                  <span className="text-info num shrink-0">
                    {["Nudge", "Approach", "Nearly there"][i]}
                  </span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {done && (
          <SolutionPanel
            cur={cur}
            setCur={setCur}
            note={note}
            onNext={onNext}
            loading={loading}
          />
        )}
      </div>

      <aside className="space-y-4 text-sm">
        <Panel title="This puzzle">
          <p className="text-paper-muted">{cur.reason}</p>
          {done && (
            <p className="text-paper-muted mt-2">
              Checked by solving it a second way: {p.verifiedBy}.
            </p>
          )}
          {!done && (
            <p className="text-paper-dim mt-2">
              Techniques are shown after you answer, so they don't give the game
              away.
            </p>
          )}
        </Panel>
        <ShortcutHelp />
      </aside>
    </div>
  );
}

function SolutionPanel({
  cur,
  setCur,
  note,
  onNext,
  loading,
}: {
  cur: Current;
  setCur: (c: Current) => void;
  note: string | null;
  onNext: () => void;
  loading: boolean;
}): JSX.Element {
  const p = useMemo(() => fromWire(cur.puzzle), [cur.puzzle]);
  const solved = cur.status === "solved";
  const clean = solved && cur.hints === 0 && cur.misses === 0;
  const assess = (v: NonNullable<PuzzleAttempt["explained"]>): void => {
    if (cur.recordedAt) annotateExplanation(p.id, cur.recordedAt, v);
    setCur({ ...cur, explained: v });
  };
  return (
    <div className="panel p-5 sm:p-6" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2
          className={cx(
            "text-lg",
            clean ? "text-bid" : solved ? "text-paper" : "text-ask",
          )}
        >
          {clean
            ? "Solved cleanly"
            : solved
              ? `Solved${cur.hints ? ` with ${cur.hints} hint${cur.hints > 1 ? "s" : ""}` : ""}${cur.misses ? ` after ${cur.misses} wrong tr${cur.misses > 1 ? "ies" : "y"}` : ""}`
              : "Solution"}
        </h2>
        <span className="text-paper-muted num">
          in {fmtClock(cur.finishedMs ?? 0)}
        </span>
        <Button
          variant="primary"
          className="ml-auto"
          onClick={onNext}
          disabled={loading}
          kbd="N"
        >
          {loading ? "Generating…" : "Next puzzle"}
        </Button>
      </div>
      <div className="mt-3 text-paper">
        Answer:{" "}
        <span className="num font-semibold">{answerText(p.answer)}</span>
        {note && <span className="text-paper-muted text-sm"> · {note}</span>}
      </div>
      <h3 className="text-sm text-paper-muted mt-5 mb-2">Worked solution</h3>
      <ol className="prose-math list-decimal pl-6 space-y-1.5 max-w-[72ch]">
        {p.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <h3 className="text-sm text-paper-muted mt-5 mb-2">
        Technique{p.techniques.length > 1 ? "s" : ""}
      </h3>
      <div className="grid sm:grid-cols-2 gap-3">
        {p.techniques.map((t) => (
          <div key={t} className="border border-ink-line rounded p-3">
            <div className="font-medium">{TECHNIQUES[t].name}</div>
            <div className="text-sm text-paper-muted mt-1">
              {TECHNIQUES[t].idea}
            </div>
            <div className="text-xs text-paper-dim mt-1">
              Reach for it with: {TECHNIQUES[t].when}
            </div>
          </div>
        ))}
      </div>
      {cur.interviewer && (
        <div className="mt-5 border-t border-ink-line pt-4">
          <h3 className="text-sm text-paper-muted mb-2">Your explanation</h3>
          <p className="font-serif text-[16px] leading-relaxed whitespace-pre-wrap text-paper-muted border-l-2 border-ink-strong pl-3">
            {cur.explanation || "—"}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
            <span className="text-paper-muted">
              Compared with the worked solution, did it name the method and
              reach the answer?
            </span>
            <Segmented
              size="sm"
              label="Self-assessment"
              value={cur.explained ?? ("" as never)}
              onChange={assess}
              options={[
                { value: "clear", label: "Clearly" },
                { value: "partial", label: "Partly" },
                { value: "missed", label: "No" },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ShortcutHelp(): JSX.Element {
  return (
    <div className="hidden sm:block">
      <Panel title="Keys">
        <ul className="space-y-1 text-paper-muted">
          <li>
            <Kbd>↵</Kbd> check answer, then next puzzle
          </li>
          <li>
            <Kbd>H</Kbd> next hint
          </li>
          <li>
            <Kbd>N</Kbd> new puzzle once answered
          </li>
          <li>
            <Kbd>1</Kbd>–<Kbd>9</Kbd> pick an option
          </li>
        </ul>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ history

const outcome = (
  h: PuzzleAttempt,
): { label: string; tone: "pos" | "neg" | "neutral" | "signal" } =>
  h.revealed
    ? { label: "Revealed", tone: "neg" }
    : !h.correct
      ? { label: "Missed", tone: "neg" }
      : h.hintsUsed || h.misses
        ? {
            label: h.hintsUsed
              ? `${h.hintsUsed} hint${h.hintsUsed > 1 ? "s" : ""}`
              : `${h.misses} miss${h.misses > 1 ? "es" : ""}`,
            tone: "signal",
          }
        : { label: "Clean", tone: "pos" };

function History(): JSX.Element {
  useStorageVersion();
  const hist = getHistory();
  const levels = getLevels();
  if (!hist.length)
    return (
      <EmptyState title="No puzzles yet">
        Solve or reveal a puzzle and it is logged here, with your level per
        category.
      </EmptyState>
    );
  const by = (c: Category) => hist.filter((h) => h.category === c);
  const cleanRate = (xs: PuzzleAttempt[]) =>
    xs.length
      ? xs.filter((h) => outcome(h).tone === "pos").length / xs.length
      : 0;
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CATEGORIES.map((c) => {
          const xs = by(c);
          const lv = levels[c] ?? 0.7;
          return (
            <div key={c} className="panel p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{CATEGORY_LABEL[c]}</span>
                <span className="text-sm text-paper-muted">
                  {TIER_LABEL[levelTier(lv)]}
                </span>
              </div>
              <ProgressBar className="mt-2" value={lv / 3} tone="info" />
              <div className="text-sm text-paper-muted mt-2 num">
                {xs.length
                  ? `${xs.length} done · ${Math.round(cleanRate(xs) * 100)}% clean`
                  : "Not tried yet"}
              </div>
            </div>
          );
        })}
      </div>
      <Panel title={`Recent (${hist.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-paper-muted">
              <tr>
                <th className="text-left font-normal py-1">When</th>
                <th className="text-left font-normal">Puzzle</th>
                <th className="text-left font-normal">Tier</th>
                <th className="text-left font-normal">Result</th>
                <th className="text-right font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {hist
                .slice(-60)
                .reverse()
                .map((h) => {
                  const o = outcome(h);
                  return (
                    <tr
                      key={`${h.id}-${h.t}`}
                      className="border-t border-ink-line/60"
                    >
                      <td className="py-1.5 pr-3 text-paper-dim whitespace-nowrap num">
                        {new Date(h.t).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="pr-3">
                        {h.title}
                        <span className="text-paper-dim">
                          {" "}
                          ·{" "}
                          {h.techniques
                            .map((t) => TECHNIQUES[t].name)
                            .join(", ")}
                        </span>
                      </td>
                      <td className="pr-3 text-paper-muted">
                        {TIER_LABEL[h.tier]}
                      </td>
                      <td className="pr-3">
                        <Badge tone={o.tone}>{o.label}</Badge>
                        {h.explained && (
                          <span className="text-paper-dim ml-2">
                            explained{" "}
                            {h.explained === "clear"
                              ? "clearly"
                              : h.explained === "partial"
                                ? "partly"
                                : "poorly"}
                          </span>
                        )}
                      </td>
                      <td className="text-right num text-paper-muted">
                        {fmtClock(h.ms)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ techniques

function Techniques({
  onPractise,
}: {
  onPractise: (t: TechniqueId) => void;
}): JSX.Element {
  useStorageVersion();
  const stats = new Map(techniqueSummary().map((s) => [s.id, s]));
  const used = new Set(ALL_GENERATORS.flatMap((g) => g.techniques));
  const ids = (Object.keys(TECHNIQUES) as TechniqueId[])
    .filter((t) => used.has(t))
    .sort((a, b) => {
      const sa = stats.get(a),
        sb = stats.get(b);
      // Due and weak first, then untried, then strong.
      const score = (s?: ReturnType<typeof stats.get>) =>
        s ? (s.due ? 2 : 1) * (1 - s.acc) + 0.5 : 0.4;
      return score(sb) - score(sa);
    });
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {ids.map((id) => {
        const t = TECHNIQUES[id];
        const s = stats.get(id);
        return (
          <div key={id} className="panel p-4 flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{t.name}</span>
              {s?.due && s.n > 0 && s.acc < 0.8 && (
                <Badge tone="signal">Due</Badge>
              )}
              <span className="ml-auto text-sm text-paper-muted num">
                {s ? `${s.clean}/${s.n} clean` : "Not met yet"}
              </span>
            </div>
            <p className="text-sm text-paper-muted mt-1">{t.idea}</p>
            <p className="text-xs text-paper-dim mt-1">{t.when}</p>
            <div className="mt-auto pt-3">
              <Button size="sm" onClick={() => onPractise(id)}>
                Practise this
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
