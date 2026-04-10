import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface AssessmentTimerProps {
  duration: number;
  onTimeUp: () => void;
  resetKey: number;
}

const AssessmentTimer = ({ duration, onTimeUp, resetKey }: AssessmentTimerProps) => {
  const [timeLeft, setTimeLeft] = useState(duration);

  useEffect(() => {
    setTimeLeft(duration);
  }, [resetKey, duration]);

  useEffect(() => {
    if (timeLeft <= 0) {
      onTimeUp();
      return;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timeLeft, onTimeUp]);

  const pct = (timeLeft / duration) * 100;
  const isWarning = timeLeft <= 15 && timeLeft > 5;
  const isDanger = timeLeft <= 5;

  const colorClass = isDanger
    ? "text-timer-danger"
    : isWarning
    ? "text-timer-warning"
    : "text-primary";

  const barColor = isDanger
    ? "bg-timer-danger"
    : isWarning
    ? "bg-timer-warning"
    : "bg-primary";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full bg-progress-track overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
      <span className={`font-display font-semibold text-sm tabular-nums min-w-[2.5rem] text-right ${colorClass} ${isDanger ? "animate-pulse" : ""}`}>
        0:{timeLeft.toString().padStart(2, "0")}
      </span>
    </div>
  );
};

export default AssessmentTimer;
