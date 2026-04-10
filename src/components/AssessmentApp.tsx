import { useState, useCallback } from "react";
import { questions } from "@/data/questions";
import { motion, AnimatePresence } from "framer-motion";
import AssessmentTimer from "./AssessmentTimer";
import ResultScreen from "./ResultScreen";
import { ChevronLeft, ChevronRight } from "lucide-react";

const TIMER_DURATION = 45;

const AssessmentApp = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);
  const [timerKey, setTimerKey] = useState(0);

  const q = questions[currentIndex];
  const total = questions.length;
  const progress = ((currentIndex + 1) / total) * 100;

  const selectOption = (optIdx: number) => {
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
    // auto-advance if no answer selected
    if (answers[q.id] === undefined) {
      setAnswers((prev) => ({ ...prev, [q.id]: -1 })); // -1 = timed out
    }
    goNext();
  }, [answers, q.id, goNext]);

  const restart = () => {
    setCurrentIndex(0);
    setAnswers({});
    setFinished(false);
    setTimerKey((k) => k + 1);
  };

  if (finished) {
    return <ResultScreen answers={answers} onRestart={restart} />;
  }

  const selected = answers[q.id];
  const answered = selected !== undefined;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground mb-1">
            CSM Post Assessment
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
            duration={TIMER_DURATION}
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
