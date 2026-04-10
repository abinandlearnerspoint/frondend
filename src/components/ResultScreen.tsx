import { questions } from "@/data/questions";
import { motion } from "framer-motion";
import { RotateCcw, CheckCircle2, XCircle, Clock } from "lucide-react";

interface ResultScreenProps {
  answers: Record<number, number>;
  onRestart: () => void;
}

const ResultScreen = ({ answers, onRestart }: ResultScreenProps) => {
  const total = questions.length;
  const correct = questions.filter((q) => answers[q.id] === q.correct_index).length;
  const timedOut = questions.filter((q) => answers[q.id] === -1).length;
  const wrong = total - correct - timedOut;
  const pct = Math.round((correct / total) * 100);

  const grade =
    pct >= 90 ? "Excellent" : pct >= 70 ? "Good" : pct >= 50 ? "Needs Improvement" : "Review Required";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-card rounded-lg border border-border p-6 sm:p-8 text-center"
      >
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground mb-2">
          Assessment Complete
        </h1>
        <p className="text-muted-foreground text-sm mb-6">CSM Post Assessment Results</p>

        {/* Score circle */}
        <div className="relative mx-auto w-32 h-32 mb-6">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--progress-track))" strokeWidth="6" />
            <motion.circle
              cx="50" cy="50" r="42" fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 42}
              initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - pct / 100) }}
              transition={{ duration: 1, delay: 0.3 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-3xl font-bold text-foreground">{pct}%</span>
            <span className="text-xs text-muted-foreground">{grade}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-secondary/40 rounded-md p-3">
            <CheckCircle2 size={18} className="mx-auto mb-1 text-success" />
            <p className="font-display font-bold text-foreground">{correct}</p>
            <p className="text-xs text-muted-foreground">Correct</p>
          </div>
          <div className="bg-secondary/40 rounded-md p-3">
            <XCircle size={18} className="mx-auto mb-1 text-danger" />
            <p className="font-display font-bold text-foreground">{wrong}</p>
            <p className="text-xs text-muted-foreground">Wrong</p>
          </div>
          <div className="bg-secondary/40 rounded-md p-3">
            <Clock size={18} className="mx-auto mb-1 text-warning" />
            <p className="font-display font-bold text-foreground">{timedOut}</p>
            <p className="text-xs text-muted-foreground">Timed Out</p>
          </div>
        </div>

        {/* Review */}
        <div className="text-left max-h-72 overflow-y-auto space-y-3 mb-6 pr-1">
          {questions.map((q, i) => {
            const ans = answers[q.id];
            const isCorrect = ans === q.correct_index;
            const isTimeout = ans === -1;
            return (
              <div key={q.id} className="bg-secondary/30 rounded-md p-3 text-sm">
                <div className="flex items-start gap-2">
                  {isCorrect ? (
                    <CheckCircle2 size={16} className="text-success mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={16} className="text-danger mt-0.5 shrink-0" />
                  )}
                  <div>
                    <p className="text-foreground font-medium mb-1">
                      {i + 1}. {q.question.slice(0, 100)}...
                    </p>
                    {!isCorrect && (
                      <p className="text-muted-foreground text-xs">
                        {isTimeout ? "Timed out. " : `Your answer: ${q.options[ans]}. `}
                        Correct: {q.options[q.correct_index]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={onRestart}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-colors"
        >
          <RotateCcw size={16} /> Retake Assessment
        </button>
      </motion.div>
    </div>
  );
};

export default ResultScreen;
