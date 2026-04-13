import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AssessmentTimer from "./AssessmentTimer";
import ResultScreen from "./ResultScreen";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useParams } from "react-router-dom";

type Question = {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
};

type AssessmentResponse = {
  type?: string;
  timer_seconds?: number;
  seconds_per_question?: number;
  questions?: unknown;
};

const DEFAULT_TIMER_SECONDS = 45;
const API_BASE = import.meta.env.VITE_ASSESSMENT_API_BASE_URL ?? "";
const API_KEY = import.meta.env.VITE_ASSESSMENT_API_KEY ?? "";

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
  const phaseFromUrl = phase === "pre" || phase === "post" ? phase : "post";
  const [questions, setQuestions] = useState<Question[]>([]);
  const [assessmentType, setAssessmentType] = useState("post");
  const [timerDuration, setTimerDuration] = useState(DEFAULT_TIMER_SECONDS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);
  const [timerKey, setTimerKey] = useState(0);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setLoadError("Missing assessment id in URL.");
      return;
    }

    let cancelled = false;
    const loadAssessment = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const endpoint = `${API_BASE}/api/v1/assessment/${encodeURIComponent(id)}/${phaseFromUrl}`;
        const res = await fetch(endpoint, {
          headers: API_KEY ? { "x-api-key": API_KEY } : undefined,
        });
        if (!res.ok) {
          let detail = "";
          try {
            const err = (await res.json()) as { detail?: unknown };
            detail = typeof err.detail === "string" ? err.detail : "";
          } catch {
            detail = "";
          }
          if (res.status === 409) {
            throw new Error(detail || "Slides are still processing. Please try again shortly.");
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

        setQuestions(normalized);
        setAssessmentType(typeof data.type === "string" ? data.type : phaseFromUrl);
        setTimerDuration(
          Math.max(
            10,
            Number(data.seconds_per_question ?? data.timer_seconds ?? DEFAULT_TIMER_SECONDS),
          ),
        );
        setCurrentIndex(0);
        setAnswers({});
        setFinished(false);
        setTimerKey((k) => k + 1);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load assessment.");
        setQuestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAssessment();
    return () => {
      cancelled = true;
    };
  }, [id, phaseFromUrl, reloadKey]);

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
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading assessment...</div>;
  }

  if (loadError) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="text-center space-y-3">
          <p className="text-destructive">{loadError}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm"
          >
            Retry
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
          <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground mb-1">
            CSM {assessmentType === "pre" ? "Pre" : "Post"} Assessment
          </h1>
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
            <span>Question {currentIndex + 1} of {total}</span>
            <span className="font-medium">
              {Object.keys(answers).length}/{total} answered
            </span>
          </div>
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

export default AssessmentApp;
