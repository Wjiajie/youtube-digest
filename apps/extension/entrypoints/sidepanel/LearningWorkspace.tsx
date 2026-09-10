import { useId, useRef, useState, type ReactNode } from "react";

const tasks = ["学习", "记录"] as const;

// Hiding a task must not dispose a private draft, Web Lock or uncertain write.
// The owning App keys this workspace by account, not by video or theme.
export function LearningWorkspace({ learn, record }: { learn: ReactNode; record: ReactNode }) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return <div className="learning-workspace">
    <div className="learning-task-tabs" role="tablist" aria-label="学习工作台">
      {tasks.map((label, index) => <button key={label} type="button" role="tab"
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`}
        aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
        ref={element => { buttons.current[index] = element; }}
        onClick={() => setSelected(index)} onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? tasks.length - 1
            : event.key === "ArrowRight" ? (index + 1) % tasks.length
            : event.key === "ArrowLeft" ? (index + tasks.length - 1) % tasks.length : null;
          if (next === null) return;
          event.preventDefault(); setSelected(next); buttons.current[next]?.focus();
        }}>{label}</button>)}
    </div>
    {[learn, record].map((content, index) => <section key={tasks[index]} className="learning-task-panel"
      id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`}
      tabIndex={0} hidden={selected !== index}>{content}</section>)}
  </div>;
}
