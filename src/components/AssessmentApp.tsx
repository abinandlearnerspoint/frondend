import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AssessmentTimer from "./AssessmentTimer";
import ResultScreen from "./ResultScreen";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

type Question = {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
};

type AssessmentResponse = {
  type?: string;
  phase?: string;
  timer_seconds?: number;
  seconds_per_question?: number;
  questions?: unknown;
  num_questions?: number;
  difficulty?: string;
  course_name?: string;
  content_hash?: string;
};

// Stored copy of a successfully-loaded session, keyed per (id, phase).
// Persisted ONLY in sessionStorage so accidental refreshes / tab restores keep
// the same questions + answers — but a deliberate "Try Again" wipes it and
// asks the backend for a fresh, freshly-generated set.
type StoredSession = {
  questions: Question[];
  assessmentType: string;
  timerDuration: number;
  contentHash?: string;
  courseName?: string;
  difficulty?: string;
  answers: Record<number, number>;
  currentIndex: number;
  finished: boolean;
  ts: number;
};

const DEFAULT_TIMER_SECONDS = 45;
// Same-origin Vercel function proxy. Keep this path stable — the slides job
// stamps the URL into Zoho once and shouldn't rotate.
const PROXY_PATH_BASE = "/api/assessment";
// Soft client-side timeout. Backend LLM calls can take 30–60s; the upstream
// proxy enforces ~110s. We give the user something to look at and a button
// to retry without re-issuing the link.
const CLIENT_TIMEOUT_MS = 90_000;

const sessionKey = (id: string, phase: string, token: string | null) =>
  `cwa:${id}:${phase}${token ? `:${token.slice(0, 8)}` : ""}`;

const loadStoredSession = (key: string): StoredSession | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
};

const persistSession = (key: string, session: StoredSession) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    // sessionStorage may be unavailable (private mode, etc.) — silently degrade.
  }
};

const clearSession = (key: string) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* noop */
  }
};

const normalizeQuestion = (raw: unknown, idx: number): Question | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = Number(obj.id ?? idx + 1);
  const question = typeof obj.question === "string" ? obj.question.trim() : "";
  const optionsRaw = Array.isArray(obj.options) ? obj.options : [];
  const options = optionsRaw.map((x) => String(x ?? "")).filter(Boolean);
  const correct =
    typeof obj.correct_index === "number"
      ? obj.correct_index
      : typeof obj.correct === "number"
        ? obj.correct
        : -1;

  if (!question || options.length === 0 || correct < 0 || correct >= options.length) return null;
  return { id, question, options, correct_index: correct };
};

const AssessmentApp = () => {
  const { id, phase } = useParams<{ id: string; phase?: string }>();
  const [searchParams] = useSearchParams();
  const phaseFromUrl: "pre" | "post" =
    phase === "pre" || phase === "post" ? phase : "post";
  // Optional signed token forwarded to the backend (kept in sessionStorage key
  // so a token rotation = a fresh question set on reopen).
  const linkToken = searchParams.get("t");
  // Optional difficulty / num_questions overrides via URL.
  const difficultyOverride = searchParams.get("difficulty");
  const numQuestionsOverride = searchParams.get("num_questions");

  const [questions, setQuestions] = useState<Question[]>([]);
  const [assessmentType, setAssessmentType] = useState<string>(phaseFromUrl);
  const [timerDuration, setTimerDuration] = useState(DEFAULT_TIMER_SECONDS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [restoredFromSession, setRestoredFromSession] = useState(false);

  // Persist progress to sessionStorage on every meaningful change so an
  // accidental reload doesn't lose answers or jump back to question 1.
  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!id || questions.length === 0) return;
    const key = sessionKey(id, phaseFromUrl, linkToken);
    if (persistTimer.current) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      persistSession(key, {
        questions,
        assessmentType,
        timerDuration,
        answers,
        currentIndex,
        finished,
        ts: Date.now(),
      });
    }, 150);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [
    id,
    phaseFromUrl,
    linkToken,
    questions,
    assessmentType,
    timerDuration,
    answers,
    currentIndex,
    finished,
  ]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setLoadError("Missing assessment id in URL.");
      return;
    }

    const key = sessionKey(id, phaseFromUrl, linkToken);

    // On the first mount for this (id, phase, token), prefer the stored
    // session if one exists so refresh / back-forward navigation does NOT
    // burn another LLM call. Explicit "Get new questions" wipes the key.
    if (reloadKey === 0) {
      const stored = loadStoredSession(key);
      if (stored) {
        setQuestions(stored.questions);
        setAssessmentType(stored.assessmentType);
        setTimerDuration(stored.timerDuration);
        setAnswers(stored.answers || {});
        setCurrentIndex(stored.currentIndex || 0);
        setFinished(Boolean(stored.finished));
        setLoading(false);
        setLoadError(null);
        setRestoredFromSession(true);
        return;
      }
    }

    setRestoredFromSession(false);

    const controller = new AbortController();
    const timeoutTimer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    let cancelled = false;

    const loadAssessment = async () => {
      setLoading(true);
      setLoadError(null);
      setGenerationStartedAt(Date.now());
      try {
        const params = new URLSearchParams();
        if (linkToken) params.set("t", linkToken);
        if (difficultyOverride) params.set("difficulty", difficultyOverride);
        if (numQuestionsOverride) params.set("num_questions", numQuestionsOverride);
        const qs = params.toString();
        const endpoint =
          `${PROXY_PATH_BASE}/${encodeURIComponent(id)}/${phaseFromUrl}` +
          (qs ? `?${qs}` : "");

        const res = await fetch(endpoint, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) {
          let detail = "";
          try {
            const err = (await res.json()) as {
              detail?: unknown;
              error?: unknown;
              upstream_status?: unknown;
              upstream_content_type?: unknown;
              upstream_excerpt?: unknown;
            };
            const candidate =
              typeof err.detail === "string"
                ? err.detail
                : typeof err.error === "string"
                  ? err.error
                  : "";
            const debugBits: string[] = [];
            if (typeof err.upstream_status === "number")
              debugBits.push(`upstream ${err.upstream_status}`);
            if (typeof err.upstream_content_type === "string")
              debugBits.push(err.upstream_content_type);
            const excerpt =
              typeof err.upstream_excerpt === "string"
                ? err.upstream_excerpt.replace(/\s+/g, " ").trim().slice(0, 160)
                : "";
            detail =
              candidate +
              (debugBits.length ? ` (${debugBits.join(" / ")})` : "") +
              (excerpt ? ` — ${excerpt}` : "");
          } catch {
            detail = "";
          }
          if (res.status === 404) {
            throw new Error(
              detail ||
                "Your courseware is still being prepared. Please try again in a few minutes.",
            );
          }
          if (res.status === 429) {
            const retryAfter = res.headers.get("Retry-After");
            throw new Error(
              detail ||
                `Too many requests right now. Please wait${
                  retryAfter ? ` ${retryAfter}s` : ""
                } and try again.`,
            );
          }
          if (res.status === 504) {
            throw new Error(
              detail ||
                "Question generation timed out. Try again — this can take up to a minute.",
            );
          }
          if (res.status >= 500) {
            throw new Error(detail || "Server error while loading assessment. Please retry.");
          }
          throw new Error(detail || `Failed to load assessment (${res.status})`);
        }

        const data = (await res.json()) as AssessmentResponse;
        const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
        const normalized = rawQuestions
          .map((q, i) => normalizeQuestion(q, i))
          .filter((q): q is Question => q !== null);

        if (cancelled) return;

        if (normalized.length === 0) {
          throw new Error(
            "The model returned no usable questions. Please try again in a moment.",
          );
        }

        const nextType =
          typeof data.phase === "string"
            ? data.phase
            : typeof data.type === "string"
              ? data.type
              : phaseFromUrl;
        const nextTimer = Math.max(
          10,
          Number(data.seconds_per_question ?? data.timer_seconds ?? DEFAULT_TIMER_SECONDS),
        );

        setQuestions(normalized);
        setAssessmentType(nextType);
        setTimerDuration(nextTimer);
        setCurrentIndex(0);
        setAnswers({});
        setFinished(false);
        setTimerKey((k) => k + 1);
        // Eagerly persist the freshly-generated set so a refresh during the
        // very first second still preserves the questions.
        persistSession(sessionKey(id, phaseFromUrl, linkToken), {
          questions: normalized,
          assessmentType: nextType,
          timerDuration: nextTimer,
          contentHash: data.content_hash,
          courseName: data.course_name,
          difficulty: data.difficulty,
          answers: {},
          currentIndex: 0,
          finished: false,
          ts: Date.now(),
        });
      } catch (error) {
        if (cancelled) return;
        const msg =
          error instanceof DOMException && error.name === "AbortError"
            ? "Question generation is taking longer than expected. Please try again — your link is still valid."
            : error instanceof Error
              ? error.message
              : "Unable to load assessment.";
        setLoadError(msg);
        setQuestions([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setGenerationStartedAt(null);
        }
        window.clearTimeout(timeoutTimer);
      }
    };

    void loadAssessment();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutTimer);
      controller.abort();
    };
  }, [id, phaseFromUrl, linkToken, difficultyOverride, numQuestionsOverride, reloadKey]);

  const requestNewQuestions = useCallback(() => {
    if (!id) return;
    clearSession(sessionKey(id, phaseFromUrl, linkToken));
    setQuestions([]);
    setAnswers({});
    setCurrentIndex(0);
    setFinished(false);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, [id, phaseFromUrl, linkToken]);

  const total = questions.length;
  const q = questions[currentIndex];
  const progress = useMemo(() => {
    if (!total) return 0;
    return ((currentIndex + 1) / total) * 100;
  }, [currentIndex, total]);

  const selectOption = (optIdx: number) => {
    if (!q) return;
    if (answers[q.id] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [q.id]: optIdx }));
  };

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) {
      setCurrentIndex((i) => i + 1);
      setTimerKey((k) => k + 1);
    } else {
      setFinished(true);
    }
  }, [currentIndex, total]);

  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setTimerKey((k) => k + 1);
    }
  };

  const handleTimeUp = useCallback(() => {
    if (!q) return;
    // auto-advance if no answer selected
    if (answers[q.id] === undefined) {
      setAnswers((prev) => ({ ...prev, [q.id]: -1 })); // -1 = timed out
    }
    goNext();
  }, [answers, q, goNext]);

  const restart = () => {
    setCurrentIndex(0);
    setAnswers({});
    setFinished(false);
    setTimerKey((k) => k + 1);
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <div className="inline-flex items-center gap-2 text-primary">
            <RefreshCw size={18} className="animate-spin" />
            <span className="font-display font-semibold text-lg">
              Generating your assessment...
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Each link produces a fresh set of questions tailored to your courseware.
            This usually takes 30–60 seconds.
          </p>
          <LoadingProgressHint startedAt={generationStartedAt} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <p className="text-destructive font-medium">{loadError}</p>
          <p className="text-xs text-muted-foreground">
            Your assessment link is still valid — retrying won&apos;t use up any
            attempts. If this keeps failing, refresh in a few minutes.
          </p>
          <button
            onClick={requestNewQuestions}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      </div>
    );
  }

  if (!total || !q) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">No questions found.</div>;
  }

  if (finished) {
    return <ResultScreen answers={answers} questions={questions} assessmentType={assessmentType} onRestart={restart} />;
  }

  const selected = answers[q.id];
  const answered = selected !== undefined;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground">
              {assessmentType === "pre" ? "Pre" : "Post"} Assessment
            </h1>
            <button
              onClick={requestNewQuestions}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Discard the current set and request a new one from the model"
            >
              <RefreshCw size={12} /> Get new questions
            </button>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
            <span>Question {currentIndex + 1} of {total}</span>
            <span className="font-medium">
              {Object.keys(answers).length}/{total} answered
            </span>
          </div>
          {restoredFromSession && (
            <p className="text-[11px] text-muted-foreground mb-3">
              Resuming where you left off in this tab. Refreshing keeps your answers.
            </p>
          )}
          {/* Progress bar */}
          <div className="h-1 rounded-full bg-progress-track overflow-hidden mb-3">
            <motion.div
              className="h-full rounded-full bg-primary"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <AssessmentTimer
            duration={timerDuration}
            onTimeUp={handleTimeUp}
            resetKey={timerKey}
          />
        </div>

        {/* Question card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={q.id}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25 }}
            className="bg-card rounded-lg border border-border p-5 sm:p-6 mb-6"
          >
            <p className="font-body text-foreground text-sm sm:text-base leading-relaxed mb-5">
              {q.question}
            </p>
            <div className="space-y-3">
              {q.options.map((opt, idx) => {
                const isSelected = selected === idx;
                const isCorrect = idx === q.correct_index;
                let optClass =
                  "border border-border bg-secondary/40 hover:bg-option-hover cursor-pointer";
                if (answered) {
                  if (isCorrect) {
                    optClass = "border-option-correct bg-option-correct/10";
                  } else if (isSelected && !isCorrect) {
                    optClass = "border-option-wrong bg-option-wrong/10";
                  } else {
                    optClass = "border-border bg-secondary/20 opacity-60";
                  }
                } else if (isSelected) {
                  optClass = "border-option-selected bg-option-selected/15";
                }

                return (
                  <button
                    key={idx}
                    onClick={() => selectOption(idx)}
                    disabled={answered}
                    className={`w-full text-left rounded-md p-3 sm:p-4 transition-all text-sm sm:text-base ${optClass}`}
                  >
                    <span className="font-display font-semibold text-muted-foreground mr-2">
                      {String.fromCharCode(65 + idx)}.
                    </span>
                    <span className="text-foreground">{opt}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="flex items-center gap-1 px-4 py-2 rounded-md bg-secondary text-secondary-foreground font-medium text-sm disabled:opacity-30 hover:bg-secondary/80 transition-colors"
          >
            <ChevronLeft size={16} /> Prev
          </button>
          <button
            onClick={goNext}
            className="flex items-center gap-1 px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-colors"
          >
            {currentIndex === total - 1 ? "Finish" : "Next"} <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

type LoadingProgressHintProps = {
  startedAt: number | null;
};

const LoadingProgressHint = ({ startedAt }: LoadingProgressHintProps) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return null;
  const pct = Math.min(95, Math.round((elapsed / 60) * 100));
  return (
    <div className="space-y-1">
      <div className="h-1 rounded-full bg-progress-track overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">~{elapsed}s elapsed</p>
    </div>
  );
};

export default AssessmentApp;
