# Preparing community research

Read this file before calling any community discovery or research tool. Its
purpose is to turn an advertising goal into a domain-neutral, reviewable search
configuration.

## Decide whether questions are needed

Use facts already supplied by the user, their site, and the conversation. Do
not ask for information that is already known.

The minimum brief must establish:

- what is being advertised and which user action matters;
- who is most likely to take that action;
- the audience's roles, needs, tasks, and signs of current intent;
- geography and language, when relevant;
- unrelated meanings, competitors, industries, or content that must be
  excluded;
- the desired breadth of the result.

Ask up to four missing questions directly in chat. When five or more material
questions remain, tell the user that the search needs a short brief and offer a
choice before asking the questions.

This choice is mandatory. Do not activate, read, or open
`interactive-project-questionnaire` merely because its normal trigger
conditions match the request. In community research, the user must choose the
questionnaire first.

If the `interactive-project-questionnaire` skill is available, offer:

> Нужно уточнить несколько параметров поиска. Ответить на вопросы в чате или
> открыть интерактивный опросник?

If that skill is not available, offer:

> Нужно уточнить несколько параметров поиска. Ответить на вопросы в чате или
> установить интерактивный опросник?

The word "установить" (or its direct equivalent in the user's language) is
required in the second option. Do not shorten this to "через опросник" and do
not imply that an unavailable questionnaire can already be opened.

Mention that the optional questionnaire skill comes from
[`sergeylopukhov/interactive-project-questionnaire`](https://github.com/sergeylopukhov/interactive-project-questionnaire).
Do not install it without the user's explicit choice.

When the user chooses installation:

1. Clone the questionnaire repository into a fresh temporary directory and
   inspect its `SKILL.md`.
2. Run its portable installer:

   ```bash
   python3 scripts/install_skill.py --agent auto
   ```

3. Verify that the installed copy is available to the current client and that
   the installer's smoke test passed.
4. If automatic detection misses the current client, rerun the installer with
   its explicit preset: `claude`, `codex`, `cursor`, `gemini`, `qwen`, `kimi`,
   or `hermes`. For another Agent Skills client, use `--target` with its global
   skills directory.

If the user asks to install the questionnaire for several agents, repeat
`--agent` or use `--agent all`. Do not overwrite an existing copy with
`--force` unless the user explicitly asks to update it; the upstream installer
creates a dated backup before a forced update.

If installation is unavailable or fails, state the reason briefly and continue
with chat questions. The questionnaire is an optional companion, not a
dependency of this skill or the MCP server.

When the questionnaire skill is already available and the user chooses it,
read its `SKILL.md` and use its own script and answer-file workflow. Do not
recreate its form or copy its implementation into this skill.

## Ask business questions, not API questions

Phrase questions in the user's language. Prefer concrete choices and allow the
user to request a recommendation. Typical subjects are:

1. Product, service, content, or person being promoted.
2. Target action: purchase, application, subscription, visit, or awareness.
3. Strongest audience roles or identities.
4. Problems and tasks that indicate active demand.
5. Geography and language.
6. Categories that look similar but are irrelevant.
7. Competitors or adjacent topics that should be included or excluded.
8. Minimum useful community size and tolerance for large broad communities.
9. Required freshness or posting frequency.
10. Desired number of final candidates and whether clusters are useful.

Do not require the user to invent VK search syntax, scoring weights, or page
budgets. Derive those technical values from the answers and explain unusual
choices.

## Build the search configuration

Create a small set of distinct search queries. Separate signals by strength:

- direct product or purchase-intent terms;
- audience roles and professional identities;
- problems, tasks, and use cases;
- broad category terms used only for discovery.

Put strong terms in `include_terms` and give them higher `term_weights`. Broad
category terms may help discovery but should not dominate scoring. Use clusters
when different audience motives need separate result groups.

Search queries may be natural multiword phrases. Scoring terms must also
include short lexical signals that are likely to appear verbatim in names,
descriptions, and posts; do not rely only on full phrases. All values in
`weights`, including fields whose names end in `_penalty`, are nonnegative
magnitudes. The server applies the subtraction.

Represent important word forms and real synonyms as separate positive scoring
terms. A conservative shared stem may be used when it is at least four letters
and has one clear meaning in the task. These variants affect score only; they
must never become a hidden eligibility gate or an automatically hardened
minus-term.

Prefer the server's default scoring scale unless custom weights are needed. If
you customize weights, add the positive score caps and set explicit
`min_score` and `review_min_score` values that are attainable on that scale;
`review_min_score` must not exceed `min_score`. Never present a `rejected`
candidate as suitable merely because it ranks first. State that no confident
candidate was found and propose a revised search instead.

Before calling a tool, verify that every `term_weights` key exactly matches one
entry in `scoring_rules.terms`. Remove orphan keys, spelling variants, and
typos. Do not invent risk-flag names. Use `exclude_risk_flags` only when the
exact flag is documented or already present in a real tool result; otherwise
omit it and rely on `exclude_terms`, score reasons, and returned risks.

Build `exclude_terms` from ambiguous meanings and clearly irrelevant
categories. With the default `exclude_match_mode=word_prefix`, a stem can match
normal word forms without matching arbitrary text inside another word. Use
`substring` only when the broader behavior is intentional.

Metadata exclusions are soft by default. They add a risk flag and score penalty,
but the community still receives post analysis and remains in the result. Use
`exclude_policy=hard` only when the user explicitly asks to remove every
metadata match. Exclusions found in public posts also remain soft.

Never replace a requested exclusion with a broader everyday synonym. Each
minus-term must be at least as specific as the unwanted meaning. For example,
exclude job listings with `ваканс`, not `работа`: ordinary product and business
posts often use the word `работа` in unrelated contexts. Review every proposed
minus-term for this false-positive risk before showing the preflight brief.
Keep meaningful qualifiers together: an unwanted `оптовый поставщик` does not
justify excluding every community that contains the general word `поставщик`.

The default search is broad: inspect up to ten pages and 1,000 provider
results for every keyword, even if the requested final count is reached
earlier. Merge all keyword results and deduplicate them before analysis.
Do not infer geography from the user's language, website, timezone, or current
location. Omit `country_id` and `city_id` by default so the search is worldwide.
Set either field only when the user explicitly requests or confirms that
geography.

Reduce `search_budget` only when the user asks for a quick or inexpensive
validation:

- small validation: one page and a low candidate limit per query;
- normal and broad research: keep the maximum per-keyword budget and use a
  saved background run.

Use the default `search_sort=members` so discovery starts with the largest
communities. Switch to `search_sort=relevance` only when the user explicitly
prefers provider relevance over audience size. Preserve descending
`members_count` order in discovery; final researched lists are still ranked by
advertising score. Analyze every community returned by VK that survives only
explicit type and member-count bounds. Positive terms and synonyms affect
scoring, but their absence from the name or description never removes a
provider result. A requested final count controls reporting, not how many
candidates receive post analysis and scoring.

Do not present provider-reported totals as the number of communities actually
inspected. Use `source_matches` for unique observed IDs and
`provider_reported_matches` only as provider context.

## Preflight and execution

Before the first tool call, show a compact search brief containing:

- advertising goal and target audience;
- search queries and strongest positive terms;
- exclusions and any risky ambiguous terms;
- geography, community types, and size limits;
- search breadth and expected result count;
- scoring emphasis and planned clusters.

If the user's original request already authorized the research, start after the
brief without asking for a second confirmation. Ask again only when an
unresolved choice could materially change the audience.

Use `vk_find_community_candidates` for a small bounded search. Use
`vk_start_community_research` for broad work, then poll progress and read the
saved run. Report incomplete reasons caused by provider or search-budget
limits.

After completion, return ranked candidates with score reasons, exclusion
matches, risks, and clusters. Recommend narrower terms, new exclusions, or a
second run when the first result reveals systematic noise. Do not export unless
the user asks.

## Let the user tune and continue

Treat a requested result count as a target, not as a reason to hide that the
search found too little. After every run, report:

- requested and returned candidate counts;
- counts by `recommended`, `review`, and `rejected`;
- the active `min_score` and `review_min_score`;
- counts for structural exclusions, soft metadata flags, hard metadata
  exclusions, missing metadata, and candidates without a positive metadata
  match;
- whether discovery, explicit structural bounds, explicit hard exclusions, or
  scoring caused the shortage.

If the current tool response does not prove the limiting stage, say that it is
unknown. Use a saved background run or a separate discovery step before
attributing the shortage to filters, scoring, or VK coverage.

If the result has no suitable candidates or fewer than requested, offer a
short choice with concrete values:

> Найдено 2 из 10 подходящих сообществ. Сейчас рекомендация начинается с 45
> баллов, ручная проверка — с 30. Можно расширить поиск, снизить пороги,
> уточнить запросы или изменить конкретный фильтр. Что выбрать?

Do not say that nothing was found when candidates exist but all were scored as
`review` or `rejected`. Name that distinction.

Accept ordinary user instructions without requiring schema terms. Examples:

- "покажи сообщества от 40 баллов";
- "сделай проходной балл 50";
- "подними вес совпадений в публикациях";
- "снизь штраф за низкую активность";
- "включи результаты для ручной проверки";
- "расширь поиск вдвое";
- "ищи дальше, пока не будет 20 подходящих".

Map them to the smallest required change:

- Change `min_score`, `review_min_score`, weights, clusters, or a subset of
  already analyzed terms with `vk_rescore_community_research_run` when a saved
  run exists. This does not read VK again.
- Use `vk_score_communities` only when the relevant community IDs are already
  available and a saved run is unnecessary.
- Start a new provider-backed search when the user adds new terms, expands
  geography or community types, changes member limits, relaxes a metadata
  exclusion, or asks for a wider discovery budget.
- A small foreground result has no reusable saved run. If the user wants more
  candidates than it returned, start a new search rather than pretending that
  rescoring can reveal unseen communities.

When the user asks to expand without specifying a size, double
`max_pages_per_query` and `max_candidates_per_query` for one round, within the
tool limits. Keep `oversample_factor` at or below 10. Show the old and new
budget. If the user explicitly authorizes repeated expansion, continue in
bounded rounds until the target count is reached or the provider and tool
limits are exhausted.

When the user asks to adjust scores without exact values, propose one modest
step, normally 10 points lower or higher for both thresholds while keeping
`review_min_score <= min_score`. Treat weight changes as an advanced option:
name the affected signal and show the old and new value. Recalculate attainable
thresholds whenever positive weights change.

When the user gives an exact recommendation threshold without a review
threshold, set `min_score` to the requested value and keep the review threshold
15 points lower, but never below zero. For example, a recommendation threshold
of 45 uses `min_score=45` and `review_min_score=30`.

Do not silently remove exclusions, lower minimum audience size, broaden
geography, or relabel an old `rejected` result. Execute the chosen change,
return the newly calculated statuses, and compare the new suitable count with
the previous run.
