"use client";

import { useState, type FormEvent } from "react";
import { geocodeLocation } from "@/lib/geocode";

type LocationSearchProps = {
  onLocationFound: (location: { lat: number; lon: number }) => void;
};

export default function LocationSearch({ onLocationFound }: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setStatus("loading");
    const result = await geocodeLocation(trimmed);
    if (result) {
      setStatus("idle");
      onLocationFound({ lat: result.lat, lon: result.lon });
    } else {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-w-0 flex-1 items-center gap-1">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (status === "error") setStatus("idle");
        }}
        placeholder="Buscar población…"
        className="w-full min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 placeholder-gray-500 shadow-md focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="rounded-md bg-white px-2.5 py-2 text-sm shadow-md hover:bg-gray-100 disabled:opacity-60"
        title="Buscar población"
        aria-label="Buscar población"
      >
        {status === "loading" ? "…" : "🔍"}
      </button>
      {status === "error" && (
        <span className="text-xs text-red-600">No encontrada</span>
      )}
    </form>
  );
}
