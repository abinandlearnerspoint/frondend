import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AssessmentTimer from "./AssessmentTimer";
import ResultScreen from "./ResultScreen";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Question = {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
};

type ModuleRow = {
  key: string;
  module_name: string;
  content: string;
};

type ApiAssessmentResponse = {
  phase?: string;
  questions?: unknown;
  num_questions?: number;
  difficulty?: string;
  course_name?: string;
  content_hash?: string;
  seconds_per_question?: number;
  timer_seconds?: number;
};

const PROXY_POST = "/api/assessment/from-modules";
const CLIENT_TIMEOUT_MS = 90_000;
const DEFAULT_TIMER = 45;

let rowId = 0;
const nextKey = () => `m-${++rowId}`;

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

const ModuleCurriculumAssessment = () => {
  const [courseName, setCourseName] = useState("Training course");
  const [phase, setPhase] = useState<"pre" | "post">("post");
  const [numQuestions, setNumQuestions] = useState(15);
  const [difficulty, setDifficulty] = useState("");
  const [preDifficulty, setPreDifficulty] = useState("intermediate");
  const [fullDocument, setFullDocument] = useState("");
  const [useSingleDocument, setUseSingleDocument] = useState(false);
  const [modules, setModules] = useState<ModuleRow[]>([
    { key: nextKey(), module_name: "Module 1", content: "" },
    { key: nextKey(), module_name: "Module 2", content: "" },
  ]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [assessmentType, setAssessmentType] = useState("post");
  const [timerDuration, setTimerDuration] = useState(DEFAULT_TIMER);
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);
  const [timerKey, setTimerKey] = useState(0);

  const updateModule = (key: string, field: "module_name" | "content", value: string) => {
    setModules((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const addModule = () => {
    setModules((rows) => [
      ...rows,
      { key: nextKey(), module_name: `Module ${rows.length + 1}`, content: "" },
    ]);
  };

  const removeModule = (key: string) => {
    setModules((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)));
  };

  const generate = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    const controller = new AbortController();
    const timeoutTimer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const payload: Record<string, unknown> = {
        phase,
        course_name: courseName.trim() || "Course",
        num_questions: Math.max(1, Math.min(50, numQuestions)),
      };
      if (useSingleDocument) {
        payload.curriculum_text = fullDocument.trim();
        payload.modules = [];
      } else {
        payload.modules = modules.map((m) => ({
          module_name: m.module_name.trim(),
          content: m.content,
        }));
        payload.curriculum_text = null;
      }
      if (difficulty.trim()) payload.difficulty = difficulty.trim();
      if (phase === "post" && preDifficulty.trim()) payload.pre_difficulty = preDifficulty.trim();

      const res = await fetch(PROXY_POST, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = (await res.json()) as ApiAssessmentResponse & {
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : typeof data.error === "string"
              ? data.error
              : `Request failed (${res.status})`;
        throw new Error(detail);
      }
      const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
      const normalized = rawQuestions
        .map((q, i) => normalizeQuestion(q, i))
        .filter((q): q is Question => q !== null);
      if (normalized.length === 0) {
        throw new Error("The model returned no usable questions. Try again or shorten content.");
      }
      const nextType = typeof data.phase === "string" ? data.phase : phase;
      const nextTimer = Math.max(
        10,
        Number(data.seconds_per_question ?? data.timer_seconds ?? DEFAULT_TIMER),
      );
      setQuestions(normalized);
      setAssessmentType(nextType);
      setTimerDuration(nextTimer);
      setCurrentIndex(0);
      setAnswers({});
      setFinished(false);
      setTimerKey((k) => k + 1);
      setQuizStarted(true);
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "Generation timed out. Try again with fewer modules or less text per module."
          : e instanceof Error
            ? e.message
            : "Generation failed.";
      setLoadError(msg);
      setQuizStarted(false);
      setQuestions([]);
    } finally {
      window.clearTimeout(timeoutTimer);
      setLoading(false);
    }
  }, [
    courseName,
    phase,
    numQuestions,
    difficulty,
    preDifficulty,
    modules,
    useSingleDocument,
    fullDocument,
  ]);

  const total = questions.length;
  const q = questions[currentIndex];
  const progress = total ? ((currentIndex + 1) / total) * 100 : 0;

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
    if (answers[q.id] === undefined) {
      setAnswers((prev) => ({ ...prev, [q.id]: -1 }));
    }
    goNext();
  }, [answers, q, goNext]);

  const restartQuiz = () => {
    setCurrentIndex(0);
    setAnswers({});
    setFinished(false);
    setTimerKey((k) => k + 1);
  };

  const backToEditor = () => {
    setQuizStarted(false);
    setQuestions([]);
    setFinished(false);
    setLoadError(null);
  };

  if (quizStarted && finished) {
    return (
      <div className="min-h-screen p-4">
        <div className="max-w-2xl mx-auto mb-4 flex justify-between items-center">
          <Button variant="outline" size="sm" onClick={backToEditor}>
            Edit curriculum
          </Button>
        </div>
        <ResultScreen
          answers={answers}
          questions={questions}
          assessmentType={assessmentType}
          onRestart={restartQuiz}
        />
      </div>
    );
  }

  if (quizStarted && total > 0 && q) {
    const selected = answers[q.id];
    const answered = selected !== undefined;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl mb-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={backToEditor}>
            Cancel quiz
          </Button>
        </div>
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground mb-1">
              {assessmentType === "pre" ? "Pre" : "Post"} assessment
            </h1>
            <p className="text-sm text-muted-foreground mb-2">{courseName}</p>
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
              <span>
                Question {currentIndex + 1} of {total}
              </span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden mb-3">
              <motion.div
                className="h-full rounded-full bg-primary"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <AssessmentTimer duration={timerDuration} onTimeUp={handleTimeUp} resetKey={timerKey} />
          </div>
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
                    "border border-border bg-secondary/40 hover:bg-secondary/60 cursor-pointer";
                  if (answered) {
                    if (isCorrect) optClass = "border-green-600 bg-green-600/10";
                    else if (isSelected && !isCorrect) optClass = "border-destructive bg-destructive/10";
                    else optClass = "border-border bg-muted/30 opacity-60";
                  } else if (isSelected) optClass = "border-primary bg-primary/10";
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => selectOption(idx)}
                      disabled={answered}
                      className={`w-full text-left rounded-md p-3 sm:p-4 transition-all text-sm sm:text-base ${optClass}`}
                    >
                      <span className="font-semibold text-muted-foreground mr-2">
                        {String.fromCharCode(65 + idx)}.
                      </span>
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={goPrev} disabled={currentIndex === 0}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>
            <Button onClick={goNext}>
              {currentIndex === total - 1 ? "Finish" : "Next"}{" "}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Assessment from module content</h1>
        <p className="text-muted-foreground text-sm mt-2">
          Enter each module&apos;s full subject text (same idea as generated courseware: Module 1, Module 2, …).
          The backend flattens it to <code className="text-xs">## Module title</code> + body and generates MCQs.
          Requires the Vercel proxy at <code className="text-xs">{PROXY_POST}</code> (or run{" "}
          <code className="text-xs">vercel dev</code>).
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="courseName">Course name</Label>
          <Input
            id="courseName"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            placeholder="e.g. Leadership fundamentals"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Phase</Label>
            <Select value={phase} onValueChange={(v) => setPhase(v as "pre" | "post")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pre">Pre (baseline from curriculum)</SelectItem>
                <SelectItem value="post">Post (after training — uses pre level hint)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nq">Number of questions (1–50)</Label>
            <Input
              id="nq"
              type="number"
              min={1}
              max={50}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value) || 15)}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="diff">Difficulty override (optional)</Label>
            <Input
              id="diff"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              placeholder="basic | intermediate | advanced"
            />
          </div>
          {phase === "post" && (
            <div className="grid gap-2">
              <Label htmlFor="pred">Pre difficulty hint (for post)</Label>
              <Input
                id="pred"
                value={preDifficulty}
                onChange={(e) => setPreDifficulty(e.target.value)}
                placeholder="intermediate"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="singleDoc"
            checked={useSingleDocument}
            onChange={(e) => setUseSingleDocument(e.target.checked)}
            className="rounded border-border"
          />
          <Label htmlFor="singleDoc" className="font-normal cursor-pointer">
            Paste one full document instead (Markdown with ## headings optional)
          </Label>
        </div>

        {useSingleDocument ? (
          <div className="grid gap-2">
            <Label htmlFor="full">Full curriculum text</Label>
            <Textarea
              id="full"
              className="min-h-[220px] font-mono text-sm"
              value={fullDocument}
              onChange={(e) => setFullDocument(e.target.value)}
              placeholder="## Module 1: ...&#10;&#10;All your content..."
            />
          </div>
        ) : (
          <div className="space-y-6">
            {modules.map((row) => (
              <div key={row.key} className="border border-border rounded-lg p-4 space-y-3 bg-card/50">
                <div className="flex justify-between items-center gap-2">
                  <Input
                    className="font-semibold max-w-md"
                    value={row.module_name}
                    onChange={(e) => updateModule(row.key, "module_name", e.target.value)}
                    placeholder="Module title"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeModule(row.key)}
                    disabled={modules.length <= 1}
                    aria-label="Remove module"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <Textarea
                  className="min-h-[160px] text-sm"
                  value={row.content}
                  onChange={(e) => updateModule(row.key, "content", e.target.value)}
                  placeholder="Full subject content for this module (objectives, topics, activities, notes)…"
                />
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addModule} className="gap-2">
              <Plus className="w-4 h-4" /> Add module
            </Button>
          </div>
        )}

        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        <Button type="button" size="lg" onClick={() => void generate()} disabled={loading} className="gap-2">
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Generating…
            </>
          ) : (
            "Generate assessment"
          )}
        </Button>
      </div>
    </div>
  );
};

export default ModuleCurriculumAssessment;
