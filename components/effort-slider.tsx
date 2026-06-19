"use client";

import { EFFORT_LEVELS, type Effort } from "@/lib/effort";

/**
 * Search-effort slider for an agent run. Three stops (Low · Medium · High) that
 * tune how many tool calls the agent makes and how deeply it researches — and
 * therefore how many tokens the run costs. See `lib/effort.ts`.
 */
export function EffortSlider({
  value,
  onChange,
  disabled = false,
}: {
  value: Effort;
  onChange: (next: Effort) => void;
  disabled?: boolean;
}) {
  const index = Math.max(
    0,
    EFFORT_LEVELS.findIndex((l) => l.value === value),
  );
  const level = EFFORT_LEVELS[index];
  const max = EFFORT_LEVELS.length - 1;

  return (
    <div className="mt-4 rounded-card border border-navy-800/10 bg-cream-50/60 px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor="effort-slider"
          className="text-sm font-semibold text-navy-800/80"
        >
          Search effort
        </label>
        <span className="font-mono text-[11px] text-navy-800/45">
          More effort uses more tokens
        </span>
      </div>

      <input
        id="effort-slider"
        type="range"
        min={0}
        max={max}
        step={1}
        value={index}
        disabled={disabled}
        onChange={(e) => onChange(EFFORT_LEVELS[Number(e.target.value)].value)}
        aria-valuetext={level.label}
        className="mt-3 block w-full cursor-pointer accent-mint-700 disabled:cursor-not-allowed disabled:opacity-50"
      />

      {/* Tick labels aligned under the track: left · center · right. */}
      <div className="mt-1.5 flex justify-between">
        {EFFORT_LEVELS.map((l, i) => {
          const active = i === index;
          return (
            <button
              key={l.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(l.value)}
              className={`text-xs font-medium transition-colors ${
                active
                  ? "text-mint-700"
                  : "text-navy-800/40 hover:text-navy-800/70"
              } disabled:cursor-not-allowed`}
            >
              {l.label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[0.8125rem] leading-snug text-navy-800/60">
        {level.blurb}
      </p>
    </div>
  );
}
