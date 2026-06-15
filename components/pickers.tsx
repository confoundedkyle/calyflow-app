"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COUNTRIES,
  PHONE_CODES,
  flagEmoji,
  joinPhone,
  splitPhone,
} from "@/lib/countries";
import { inputClass } from "@/components/ui";

const labelClass = "mb-1.5 block text-sm font-semibold text-navy-800/80";
const panelClass =
  "absolute z-30 mt-1 max-h-72 w-full min-w-[16rem] overflow-hidden rounded-card border border-navy-800/15 bg-white shadow-lift";
const optionClass =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-mint-400/15";

// Close the dropdown on an outside click or Escape.
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

// Keep the search input from submitting the surrounding form on Enter.
function swallowEnter(e: React.KeyboardEvent) {
  if (e.key === "Enter") e.preventDefault();
}

export function CountrySelect({
  name = "country",
  label = "Country",
  defaultValue = "",
  required = false,
}: {
  name?: string;
  label?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useDismiss(open, () => setOpen(false));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q))
      : COUNTRIES;
  }, [query]);

  const selected = COUNTRIES.find((c) => c.name === value);

  function choose(next: string) {
    setValue(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="block">
      <span className={labelClass}>{label}</span>
      <div ref={ref} className="relative">
        <input type="hidden" name={name} value={value} required={required} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`${inputClass} flex items-center justify-between gap-2 text-left`}
        >
          <span className={value ? "truncate" : "truncate text-navy-800/35"}>
            {selected
              ? `${flagEmoji(selected.iso2)}  ${selected.name}`
              : value || "Select country…"}
          </span>
          <span aria-hidden className="text-navy-800/40">
            ▾
          </span>
        </button>
        {open && (
          <div className={panelClass}>
            <div className="border-b border-navy-800/10 p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={swallowEnter}
                placeholder="Search countries…"
                aria-label="Search countries"
                className={`${inputClass} !py-1.5 text-sm`}
              />
            </div>
            <ul className="max-h-56 overflow-auto py-1">
              {value && (
                <li>
                  <button
                    type="button"
                    onClick={() => choose("")}
                    className={`${optionClass} text-navy-800/45`}
                  >
                    — Clear —
                  </button>
                </li>
              )}
              {filtered.map((c) => (
                <li key={c.iso2}>
                  <button
                    type="button"
                    onClick={() => choose(c.name)}
                    className={`${optionClass} ${c.name === value ? "bg-mint-400/15 font-semibold" : ""}`}
                  >
                    <span aria-hidden>{flagEmoji(c.iso2)}</span>
                    <span className="truncate">{c.name}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-navy-800/45">
                  No matches
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function PhoneInput({
  name = "phone",
  label = "Phone",
  defaultValue = "",
}: {
  name?: string;
  label?: string;
  defaultValue?: string;
}) {
  const initial = splitPhone(defaultValue);
  const [dial, setDial] = useState(initial.dial);
  const [number, setNumber] = useState(initial.number);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useDismiss(open, () => setOpen(false));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PHONE_CODES;
    const digits = q.replace(/\D/g, "");
    return PHONE_CODES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (digits && c.dial.startsWith(digits)),
    );
  }, [query]);

  const selected = dial ? PHONE_CODES.find((c) => c.dial === dial) : undefined;

  function choose(next: string) {
    setDial(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="block">
      <span className={labelClass}>{label}</span>
      <div className="flex gap-2">
        <div ref={ref} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Country dialing code"
            className={`${inputClass} flex w-[6.5rem] items-center justify-between gap-1`}
          >
            <span className={dial ? "" : "text-navy-800/35"}>
              {dial ? `${selected ? flagEmoji(selected.iso2) : ""} +${dial}` : "+ Code"}
            </span>
            <span aria-hidden className="text-navy-800/40">
              ▾
            </span>
          </button>
          {open && (
            <div className={panelClass}>
              <div className="border-b border-navy-800/10 p-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={swallowEnter}
                  placeholder="Search country or code…"
                  aria-label="Search dialing codes"
                  className={`${inputClass} !py-1.5 text-sm`}
                />
              </div>
              <ul className="max-h-56 overflow-auto py-1">
                {dial && (
                  <li>
                    <button
                      type="button"
                      onClick={() => choose("")}
                      className={`${optionClass} text-navy-800/45`}
                    >
                      — Clear —
                    </button>
                  </li>
                )}
                {filtered.map((c) => (
                  <li key={c.iso2}>
                    <button
                      type="button"
                      onClick={() => choose(c.dial)}
                      className={`${optionClass} ${c.dial === dial ? "bg-mint-400/15 font-semibold" : ""}`}
                    >
                      <span aria-hidden>{flagEmoji(c.iso2)}</span>
                      <span className="w-14 shrink-0 tabular-nums text-navy-800/60">
                        +{c.dial}
                      </span>
                      <span className="truncate">{c.name}</span>
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-sm text-navy-800/45">
                    No matches
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          inputMode="tel"
          placeholder="Phone number"
          aria-label="Phone number"
          className={inputClass}
        />
      </div>
      <input type="hidden" name={name} value={joinPhone(dial, number)} />
    </div>
  );
}
