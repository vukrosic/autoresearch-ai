// `autoresearch bench` — benchmark suite presets.
//
// Researchers shouldn't have to re-type the same `eval.yaml` block every time
// they want to plug MMLU / HumanEval / GSM8K into autoresearch. This command
// owns a small registry of benchmark presets (just metadata + recommended
// metric names + a hint command) and writes the matching `eval.yaml` snippet
// into the project's eval file.
//
// We don't run benchmarks here — that's `autoresearch run`'s job. We only
// scaffold the config and document what to expect.

import fs from "node:fs";
import path from "node:path";

const PRESETS = {
  mmlu: {
    description: "Massive Multitask Language Understanding (57 subjects, 0-shot or 5-shot)",
    metric_name: "mmlu_acc",
    direction: "higher",
    hint_command: "python eval/mmlu.py --shots 5 --output mmlu.json",
    regex: "mmlu_acc=([0-9.]+)",
    citation: "Hendrycks et al. 2020 (arXiv:2009.03300)",
    contamination_note: "Major contamination risk in 2024+ LLMs; consider held-out subsets.",
  },
  humaneval: {
    description: "HumanEval coding benchmark (164 hand-written problems, pass@1)",
    metric_name: "humaneval_pass1",
    direction: "higher",
    hint_command: "python eval/humaneval.py --k 1 --output humaneval.json",
    regex: "humaneval_pass1=([0-9.]+)",
    citation: "Chen et al. 2021 (arXiv:2107.03374)",
    contamination_note: "Heavily contaminated in most pretraining corpora — use MBPP+ or LiveCodeBench for fresh signal.",
  },
  gsm8k: {
    description: "GSM8K grade-school math word problems (1.3k test, accuracy)",
    metric_name: "gsm8k_acc",
    direction: "higher",
    hint_command: "python eval/gsm8k.py --shots 8 --output gsm8k.json",
    regex: "gsm8k_acc=([0-9.]+)",
    citation: "Cobbe et al. 2021 (arXiv:2110.14168)",
    contamination_note: "Some leakage in modern LLMs; use exact-match scoring.",
  },
  arc: {
    description: "ARC Challenge (multiple choice science questions, 25-shot)",
    metric_name: "arc_challenge_acc",
    direction: "higher",
    hint_command: "python eval/arc.py --subset challenge --shots 25",
    regex: "arc_challenge_acc=([0-9.]+)",
    citation: "Clark et al. 2018 (arXiv:1803.05457)",
  },
  truthfulqa: {
    description: "TruthfulQA (817 questions across 38 categories; MC1 + MC2)",
    metric_name: "truthfulqa_mc2",
    direction: "higher",
    hint_command: "python eval/truthfulqa.py --variant mc2",
    regex: "truthfulqa_mc2=([0-9.]+)",
    citation: "Lin et al. 2021 (arXiv:2109.07958)",
  },
  hellaswag: {
    description: "HellaSwag (commonsense completion, 10k val, 10-shot)",
    metric_name: "hellaswag_acc",
    direction: "higher",
    hint_command: "python eval/hellaswag.py --shots 10",
    regex: "hellaswag_acc=([0-9.]+)",
    citation: "Zellers et al. 2019 (arXiv:1905.07830)",
  },
  mbpp: {
    description: "MBPP (974 Python programming problems, pass@1)",
    metric_name: "mbpp_pass1",
    direction: "higher",
    hint_command: "python eval/mbpp.py --k 1",
    regex: "mbpp_pass1=([0-9.]+)",
    citation: "Austin et al. 2021 (arXiv:2108.07732)",
  },
  bbh: {
    description: "BIG-Bench Hard (23 challenging tasks, 3-shot CoT)",
    metric_name: "bbh_avg",
    direction: "higher",
    hint_command: "python eval/bbh.py --shots 3 --cot",
    regex: "bbh_avg=([0-9.]+)",
    citation: "Suzgun et al. 2022 (arXiv:2210.09261)",
  },
};

function evalYamlPath(cwd) {
  return path.join(cwd, ".researchloop", "eval.yaml");
}

// Naively append a metric stanza if not already present. We use textual
// containment rather than a YAML parser; the format is simple enough that
// false positives are unlikely.
function appendMetric(yamlText, metric) {
  const stanza = [
    `  - name: ${metric.metric_name}`,
    `    direction: ${metric.direction}`,
    `    regex: '${metric.regex}'`,
    `    source: stdout`,
  ].join("\n");
  if (yamlText.includes(`name: ${metric.metric_name}`)) {
    return { yaml: yamlText, changed: false, reason: "already present" };
  }
  if (!yamlText.includes("metrics:")) {
    return { yaml: yamlText + (yamlText.endsWith("\n") ? "" : "\n") + `metrics:\n${stanza}\n`, changed: true, reason: "added new metrics block" };
  }
  // Insert just after `metrics:` line.
  const lines = yamlText.split("\n");
  const idx = lines.findIndex((l) => l.trim().startsWith("metrics:"));
  if (idx === -1) return { yaml: yamlText + `\nmetrics:\n${stanza}\n`, changed: true, reason: "appended new metrics block" };
  lines.splice(idx + 1, 0, stanza);
  return { yaml: lines.join("\n"), changed: true, reason: "appended under existing metrics" };
}

export async function cmdBench(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  // Subcommand: list | add | info | which
  const sub = args.find((a, i) => i > 0 && a !== "bench" && !a.startsWith("-")) || "list";

  if (sub === "list") {
    if (formatJson) {
      console.log(JSON.stringify({ presets: Object.entries(PRESETS).map(([id, p]) => ({ id, ...p })) }, null, 2));
      return;
    }
    console.log("autoresearch bench — available presets:");
    console.log("");
    console.log("| id | metric | direction | description |");
    console.log("| --- | --- | --- | --- |");
    for (const [id, p] of Object.entries(PRESETS)) {
      console.log(`| ${id} | ${p.metric_name} | ${p.direction} | ${p.description} |`);
    }
    console.log("");
    console.log("Inspect: autoresearch bench info <id>");
    console.log("Add to eval.yaml: autoresearch bench add <id>");
    return;
  }

  if (sub === "info") {
    const id = args[args.indexOf("info") + 1];
    if (!id || !PRESETS[id]) {
      console.error(`Unknown preset: ${id || "(missing)"}.  Run \`autoresearch bench list\` to see options.`);
      process.exitCode = 1;
      return;
    }
    const p = PRESETS[id];
    if (formatJson) {
      console.log(JSON.stringify({ id, ...p }, null, 2));
      return;
    }
    console.log(`# ${id}`);
    console.log("");
    console.log(p.description);
    console.log("");
    console.log(`- metric: \`${p.metric_name}\``);
    console.log(`- direction: ${p.direction}`);
    console.log(`- hint command: \`${p.hint_command}\``);
    console.log(`- regex: \`${p.regex}\``);
    console.log(`- citation: ${p.citation}`);
    if (p.contamination_note) console.log(`- contamination: ${p.contamination_note}`);
    return;
  }

  if (sub === "add") {
    const id = args[args.indexOf("add") + 1];
    if (!id || !PRESETS[id]) {
      console.error(`Unknown preset: ${id || "(missing)"}.  Run \`autoresearch bench list\` to see options.`);
      process.exitCode = 1;
      return;
    }
    const p = PRESETS[id];
    const ymlPath = evalYamlPath(cwd);
    const existing = fs.existsSync(ymlPath) ? fs.readFileSync(ymlPath, "utf8") : "";
    const dry = hasFlag("--dry-run");
    const result = appendMetric(existing, p);
    if (!result.changed) {
      console.log(`bench: ${id} already configured (${result.reason}).`);
      return;
    }
    if (dry) {
      console.log("---");
      console.log(result.yaml);
      console.log("---");
      console.log(`would write: ${ymlPath} (${result.reason})`);
      return;
    }
    fs.mkdirSync(path.dirname(ymlPath), { recursive: true });
    fs.writeFileSync(ymlPath, result.yaml);
    console.log(`added ${id} metric to ${path.relative(cwd, ymlPath)} (${result.reason})`);
    console.log(`run it with: ${p.hint_command}`);
    return;
  }

  console.error(`Unknown subcommand: ${sub}. Use: list | info <id> | add <id>`);
  process.exitCode = 1;
}
