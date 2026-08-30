// Type-only import: erased at compile time, so it cannot read env before loadEnv().
import type { Profile } from "@/lib/db/types";
import { loadEnv } from "./env";

loadEnv();

const { getWriteRepo } = await import("@/lib/db");
const { scoreAll } = await import("@/lib/pipeline/match");

/** Demo profiles so the matching view has something to render on a fresh clone. */
const PROFILES: Profile[] = [
  {
    id: "p_ml_systems",
    name: "ML systems researcher",
    disciplines: ["computer science", "engineering", "mathematics"],
    keywords: ["machine learning", "distributed systems", "algorithms", "robotics"],
    career_stage: "early-career",
    country: "PK",
    min_award: 100_000,
  },
  {
    id: "p_neuro",
    name: "Cognitive neuroscientist",
    disciplines: ["neuroscience", "psychology", "medicine"],
    keywords: ["mental health", "depression", "cognition", "intervention"],
    career_stage: "postdoc",
    country: "GB",
    min_award: 50_000,
  },
  {
    id: "p_climate",
    name: "Climate data scientist",
    disciplines: ["climate", "engineering", "computer science"],
    keywords: ["observation", "sensor", "earth systems", "open data"],
    career_stage: "established",
    country: "US",
    min_award: 1_000_000,
  },
];

const repo = await getWriteRepo();
for (const profile of PROFILES) await repo.upsertProfile(profile);

const opportunities = await repo.listOpportunities({ limit: 1000 });
for (const profile of PROFILES) await repo.saveMatches(scoreAll(opportunities, profile));

console.log(
  `[seed] ${PROFILES.length} profiles scored against ${opportunities.length} opportunities (${repo.name} store)`,
);
