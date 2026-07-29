# Detailed reporting

Use Russian by default. Keep the report decision-oriented while preserving the
evidence needed to verify each conclusion.

## Structure

1. **Итог** — the main conclusion and the most important action.
2. **Охват анализа** — account/object level, IDs when safe, period, comparison
   period, timezone, filters, and data completeness.
3. **Ключевые показатели** — actual values, changes, and denominators.
4. **Что работает** — strongest objects or trends with supporting metrics.
5. **Проблемы и риски** — weak objects, delivery constraints, data gaps,
   partial periods, and provider/tool limitations.
6. **Рекомендации** — prioritized actions with expected direction of impact,
   not invented forecasts.
7. **Следующие действия** — concrete reads or explicit writes the user can
   request.

## Analysis rules

- Prefer the latest complete comparable period. Label partial periods clearly.
- Compare like with like: same aggregation, attribution model, object level,
  timezone, and duration.
- Distinguish observations from hypotheses and recommendations.
- Do not infer profitability without revenue or business-value data.
- Do not calculate conversion rates when the required numerator or denominator
  is absent.
- For empty results, distinguish a valid empty provider response from a failed
  or unverified tool.
- Mention every `⛔️` tool used and preserve its unverified or non-working
  status regardless of the returned payload.
- For community research, present ranked candidates with reasons, risks,
  clusters, and recommended next actions.
- End with the smallest useful next step; do not perform writes unless they
  were explicitly requested.
